import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import express, { type NextFunction, type Request, type Response } from 'express';
import QRCode from 'qrcode';
import {
  BookRecommendationEngine,
  FineCalculator,
  LIBRARY_TIME_SLOTS,
  QRCodePayloadService,
  SeatReservationValidator,
} from './src/domain/LibraryOOP.ts';
import type {
  AnalyticsReport,
  Book,
  BorrowTransaction,
  DigitalChapter,
  DigitalResource,
  DigitalResourceType,
  SeatBooking,
  UserProfile,
  UserRole,
} from './src/domain/types.ts';
import {
  buildBookQrPayload,
  db,
  hashPassword,
  initDatabase,
  syncOverdueAndAlerts,
  verifyPassword,
} from './server/db.ts';

initDatabase();

const SESSION_SECRET = process.env.SESSION_SECRET || crypto.randomBytes(32).toString('hex');
const PORT = Number(process.env.PORT || 3000);

interface SessionPayload {
  userId: number;
  role: UserRole;
  exp: number;
}

interface AuthenticatedRequest extends Request {
  authUser?: UserProfile;
}

function signToken(payload: SessionPayload): string {
  const encoded = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const sig = crypto.createHmac('sha256', SESSION_SECRET).update(encoded).digest('base64url');
  return `${encoded}.${sig}`;
}

function verifyToken(token: string): SessionPayload | null {
  const parts = token.split('.');
  if (parts.length !== 2) return null;
  const [encoded, sig] = parts;
  const expectedSig = crypto.createHmac('sha256', SESSION_SECRET).update(encoded).digest('base64url');
  const sigBuf = Buffer.from(sig);
  const expectedBuf = Buffer.from(expectedSig);
  if (sigBuf.length !== expectedBuf.length || !crypto.timingSafeEqual(sigBuf, expectedBuf)) {
    return null;
  }
  try {
    const parsed = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8')) as SessionPayload;
    if (!parsed.userId || !parsed.exp || Date.now() > parsed.exp) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

function getUserProfileById(userId: number): UserProfile | null {
  const row = db
    .prepare(
      `SELECT u.id, u.name, u.email, u.role, u.active, u.created_at,
              s.enrollment_number, s.department, s.semester, s.interests_json,
              l.employee_id, l.office_hours
       FROM users u
       LEFT JOIN students s ON s.user_id = u.id
       LEFT JOIN librarians l ON l.user_id = u.id
       WHERE u.id = ?`
    )
    .get(userId) as
    | {
        id: number;
        name: string;
        email: string;
        role: UserRole;
        active: number;
        created_at: string;
        enrollment_number: string | null;
        department: string | null;
        semester: number | null;
        interests_json: string | null;
        employee_id: string | null;
        office_hours: string | null;
      }
    | undefined;

  if (!row) return null;

  let interests: string[] = [];
  if (row.interests_json) {
    try {
      interests = JSON.parse(row.interests_json) as string[];
    } catch {
      interests = [];
    }
  }

  return {
    id: row.id,
    name: row.name,
    email: row.email,
    role: row.role,
    active: row.active === 1,
    createdAt: row.created_at,
    enrollmentNumber: row.enrollment_number ?? undefined,
    department: row.department ?? undefined,
    semester: row.semester ?? undefined,
    interests: row.role === 'STUDENT' ? interests : undefined,
    employeeId: row.employee_id ?? undefined,
    officeHours: row.office_hours ?? undefined,
  };
}

function requireAuth(req: AuthenticatedRequest, res: Response, next: NextFunction): void {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    res.status(401).json({ error: 'Authentication required.' });
    return;
  }
  const token = authHeader.slice(7).trim();
  const payload = verifyToken(token);
  if (!payload) {
    res.status(401).json({ error: 'Session expired or invalid. Please sign in again.' });
    return;
  }
  const user = getUserProfileById(payload.userId);
  if (!user || !user.active) {
    res.status(403).json({ error: 'Account is disabled or unavailable.' });
    return;
  }
  req.authUser = user;
  next();
}

function parsePositiveInt(raw: unknown): number | null {
  const num = Number(raw);
  return Number.isInteger(num) && num > 0 ? num : null;
}

function getLocalDateStr(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}

function requireRole(role: UserRole) {
  return (req: AuthenticatedRequest, res: Response, next: NextFunction): void => {
    if (!req.authUser || req.authUser.role !== role) {
      res.status(403).json({ error: `Access denied. ${role} privileges required.` });
      return;
    }
    next();
  };
}

function mapBookRow(row: {
  id: number;
  isbn: string;
  title: string;
  author: string;
  publisher: string;
  publication_year: number;
  category_id: number;
  category_name: string;
  total_copies: number;
  available_copies: number;
  shelf_location: string;
  description: string;
  cover_url: string;
  borrow_count?: number;
}): Book {
  return {
    id: row.id,
    isbn: row.isbn,
    title: row.title,
    author: row.author,
    publisher: row.publisher,
    publicationYear: row.publication_year,
    categoryId: row.category_id,
    categoryName: row.category_name,
    totalCopies: row.total_copies,
    availableCopies: row.available_copies,
    shelfLocation: row.shelf_location,
    description: row.description,
    coverUrl: row.cover_url,
    qrPayload: buildBookQrPayload(row.id, row.isbn),
    borrowCount: row.borrow_count ?? 0,
  };
}

function fetchAllBooks(search = '', categoryId?: number): Book[] {
  const conditions: string[] = [];
  const params: Array<string | number> = [];

  if (search.trim()) {
    const like = `%${search.trim().toLowerCase()}%`;
    conditions.push(
      '(LOWER(b.title) LIKE ? OR LOWER(b.author) LIKE ? OR LOWER(b.isbn) LIKE ? OR LOWER(c.name) LIKE ?)'
    );
    params.push(like, like, like, like);
  }
  if (categoryId && !Number.isNaN(categoryId)) {
    conditions.push('b.category_id = ?');
    params.push(categoryId);
  }

  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
  const rows = db
    .prepare(
      `SELECT b.*, c.name AS category_name,
              (SELECT COUNT(*) FROM borrow_transactions bt WHERE bt.book_id = b.id AND bt.status != 'REJECTED') AS borrow_count
       FROM books b
       JOIN categories c ON c.id = b.category_id
       ${whereClause}
       ORDER BY b.id DESC`
    )
    .all(...params) as Parameters<typeof mapBookRow>[0][];

  return rows.map(mapBookRow);
}

function fetchTransactions(studentUserId?: number): BorrowTransaction[] {
  syncOverdueAndAlerts();
  const where = studentUserId ? 'WHERE bt.student_user_id = ?' : '';
  const rows = db
    .prepare(
      `SELECT bt.*, b.title AS book_title, b.author AS book_author, b.isbn AS book_isbn,
              b.cover_url AS book_cover_url, c.name AS category_name,
              u.name AS student_name, u.email AS student_email,
              COALESCE(s.enrollment_number, 'LIB') AS enrollment_number,
              app.name AS approved_by_name,
              f.amount AS fine_amount
       FROM borrow_transactions bt
       JOIN books b ON b.id = bt.book_id
       JOIN categories c ON c.id = b.category_id
       JOIN users u ON u.id = bt.student_user_id
       LEFT JOIN students s ON s.user_id = u.id
       LEFT JOIN users app ON app.id = bt.approved_by_user_id
       LEFT JOIN fines f ON f.transaction_id = bt.id
       ${where}
       ORDER BY bt.id DESC`
    )
    .all(...(studentUserId ? [studentUserId] : [])) as Array<{
    id: number;
    book_id: number;
    book_title: string;
    book_author: string;
    book_isbn: string;
    book_cover_url: string;
    category_name: string;
    student_user_id: number;
    student_name: string;
    student_email: string;
    enrollment_number: string;
    status: BorrowTransaction['status'];
    requested_at: string;
    issued_at: string | null;
    due_date: string | null;
    returned_at: string | null;
    approved_by_name: string | null;
    fine_amount: number | null;
  }>;

  const nowIso = new Date().toISOString();
  return rows.map((r) => {
    const isActive = r.status === 'BORROWED' || r.status === 'OVERDUE';
    const daysOverdue =
      isActive && r.due_date ? FineCalculator.calculateOverdueDays(r.due_date, nowIso) : 0;
    const daysRemaining =
      isActive && r.due_date ? FineCalculator.getDaysRemaining(r.due_date, nowIso) : null;
    const calculatedFine =
      r.fine_amount !== null ? r.fine_amount : FineCalculator.calculateFineAmount(daysOverdue);

    return {
      id: r.id,
      bookId: r.book_id,
      bookTitle: r.book_title,
      bookAuthor: r.book_author,
      bookIsbn: r.book_isbn,
      bookCoverUrl: r.book_cover_url,
      categoryName: r.category_name,
      studentUserId: r.student_user_id,
      studentName: r.student_name,
      studentEmail: r.student_email,
      enrollmentNumber: r.enrollment_number,
      status: r.status,
      requestedAt: r.requested_at,
      issuedAt: r.issued_at,
      dueDate: r.due_date,
      returnedAt: r.returned_at,
      approvedByName: r.approved_by_name,
      calculatedFine,
      daysOverdue,
      daysRemaining,
    };
  });
}

function createNotification(userId: number, title: string, message: string, type: string): void {
  db.prepare(
    'INSERT INTO notifications (user_id, title, message, type, is_read, created_at) VALUES (?, ?, ?, ?, 0, ?)'
  ).run(userId, title, message, type, new Date().toISOString());
}

const app = express();
app.use(express.json({ limit: '1mb' }));

// Health check
app.get('/api/health', (_req, res) => {
  res.json({ ok: true, service: 'Smart Library Management System' });
});

// ================= AUTHENTICATION =================
app.post('/api/auth/login', (req, res) => {
  const { email, password, portalRole } = req.body as {
    email?: string;
    password?: string;
    portalRole?: UserRole;
  };

  if (!email?.trim() || !password) {
    res.status(400).json({ error: 'Email and password are required.' });
    return;
  }

  const userRow = db
    .prepare('SELECT id, password_hash, role, active FROM users WHERE LOWER(email) = LOWER(?)')
    .get(email.trim()) as
    | { id: number; password_hash: string; role: UserRole; active: number }
    | undefined;

  if (!userRow || !verifyPassword(password, userRow.password_hash)) {
    res.status(401).json({ error: 'Invalid email or password.' });
    return;
  }

  if (userRow.active !== 1) {
    res.status(403).json({ error: 'This account has been deactivated by the librarian.' });
    return;
  }

  if (portalRole && userRow.role !== portalRole) {
    res.status(403).json({
      error: `This account belongs to the ${userRow.role === 'LIBRARIAN' ? 'Librarian/Admin' : 'Student'} Portal. Please switch portal tabs.`,
    });
    return;
  }

  syncOverdueAndAlerts();
  const profile = getUserProfileById(userRow.id);
  const token = signToken({
    userId: userRow.id,
    role: userRow.role,
    exp: Date.now() + 12 * 3600 * 1000,
  });

  res.json({ token, user: profile });
});

app.post('/api/auth/register', (req, res) => {
  const { name, email, password, enrollmentNumber, department, semester, interests } = req.body as {
    name?: string;
    email?: string;
    password?: string;
    enrollmentNumber?: string;
    department?: string;
    semester?: number;
    interests?: string[];
  };

  if (!name?.trim() || !email?.trim() || !password || !enrollmentNumber?.trim() || !department?.trim()) {
    res.status(400).json({
      error: 'Full name, email, password, enrollment number, and department are required.',
    });
    return;
  }

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
    res.status(400).json({ error: 'Please enter a valid academic email address.' });
    return;
  }

  if (password.length < 6) {
    res.status(400).json({ error: 'Password must be at least 6 characters long.' });
    return;
  }

  const existingEmail = db
    .prepare('SELECT id FROM users WHERE LOWER(email) = LOWER(?)')
    .get(email.trim());
  if (existingEmail) {
    res.status(409).json({ error: 'An account with this email already exists.' });
    return;
  }

  const existingEnroll = db
    .prepare('SELECT user_id FROM students WHERE LOWER(enrollment_number) = LOWER(?)')
    .get(enrollmentNumber.trim());
  if (existingEnroll) {
    res.status(409).json({ error: 'This enrollment number is already registered.' });
    return;
  }

  const safeInterests = Array.isArray(interests) && interests.length > 0 ? interests : ['Software Engineering'];

  try {
    db.exec('BEGIN');
    const uRes = db
      .prepare('INSERT INTO users (name, email, password_hash, role, active) VALUES (?, ?, ?, ?, 1)')
      .run(name.trim(), email.trim().toLowerCase(), hashPassword(password), 'STUDENT');
    const newUserId = Number(uRes.lastInsertRowid);

    db.prepare(
      'INSERT INTO students (user_id, enrollment_number, department, semester, interests_json) VALUES (?, ?, ?, ?, ?)'
    ).run(
      newUserId,
      enrollmentNumber.trim().toUpperCase(),
      department.trim(),
      Math.max(1, Math.min(10, Number(semester) || 1)),
      JSON.stringify(safeInterests)
    );
    db.exec('COMMIT');

    createNotification(
      newUserId,
      'Welcome to Smart Library',
      'Your student account is active. You may borrow up to 5 books and reserve study seats.',
      'INFO'
    );

    const profile = getUserProfileById(newUserId);
    const token = signToken({
      userId: newUserId,
      role: 'STUDENT',
      exp: Date.now() + 12 * 3600 * 1000,
    });

    res.status(201).json({ token, user: profile });
  } catch (err) {
    try {
      db.exec('ROLLBACK');
    } catch {
      // ignore rollback error
    }
    res.status(500).json({ error: 'Unable to complete registration. Please try again.' });
  }
});

app.get('/api/auth/me', requireAuth, (req: AuthenticatedRequest, res) => {
  res.json({ user: req.authUser });
});

app.put('/api/profile', requireAuth, (req: AuthenticatedRequest, res) => {
  const user = req.authUser!;
  const { name, department, semester, interests, officeHours } = req.body as {
    name?: string;
    department?: string;
    semester?: number;
    interests?: string[];
    officeHours?: string;
  };

  if (!name?.trim()) {
    res.status(400).json({ error: 'Name cannot be empty.' });
    return;
  }

  db.prepare('UPDATE users SET name = ? WHERE id = ?').run(name.trim(), user.id);

  if (user.role === 'STUDENT') {
    const cleanInterests = Array.isArray(interests)
      ? interests.map((s) => s.trim()).filter(Boolean)
      : user.interests ?? [];
    db.prepare(
      'UPDATE students SET department = ?, semester = ?, interests_json = ? WHERE user_id = ?'
    ).run(
      department?.trim() || user.department || 'General Studies',
      Math.max(1, Math.min(10, Number(semester) || user.semester || 1)),
      JSON.stringify(cleanInterests),
      user.id
    );
  } else if (user.role === 'LIBRARIAN' && officeHours?.trim()) {
    db.prepare('UPDATE librarians SET office_hours = ? WHERE user_id = ?').run(
      officeHours.trim(),
      user.id
    );
  }

  res.json({ user: getUserProfileById(user.id) });
});

// ================= CATALOG & BOOKS =================
app.get('/api/categories', requireAuth, (_req, res) => {
  const categories = db.prepare('SELECT id, name, description FROM categories ORDER BY name ASC').all();
  res.json({ categories });
});

app.get('/api/books', requireAuth, (req, res) => {
  const search = typeof req.query.search === 'string' ? req.query.search : '';
  const categoryId = req.query.categoryId ? Number(req.query.categoryId) : undefined;
  const books = fetchAllBooks(search, categoryId);
  res.json({ books });
});

app.get('/api/books/:id/qr', requireAuth, async (req, res) => {
  const bookId = Number(req.params.id);
  const bookRow = db.prepare('SELECT id, isbn, title FROM books WHERE id = ?').get(bookId) as
    | { id: number; isbn: string; title: string }
    | undefined;
  if (!bookRow) {
    res.status(404).json({ error: 'Book not found.' });
    return;
  }

  const payload = buildBookQrPayload(bookRow.id, bookRow.isbn);
  const qrDataUrl = await QRCode.toDataURL(payload, {
    width: 280,
    margin: 2,
    color: { dark: '#0F1E36', light: '#FFFFFF' },
  });
  const qrSvg = await QRCode.toString(payload, {
    type: 'svg',
    margin: 1,
    color: { dark: '#0F1E36', light: '#FFFFFF' },
  });

  res.json({ payload, qrDataUrl, qrSvg, bookTitle: bookRow.title, isbn: bookRow.isbn });
});

app.post('/api/books', requireAuth, requireRole('LIBRARIAN'), (req: AuthenticatedRequest, res) => {
  const {
    isbn,
    title,
    author,
    publisher,
    publicationYear,
    categoryId,
    totalCopies,
    shelfLocation,
    description,
  } = req.body as {
    isbn?: string;
    title?: string;
    author?: string;
    publisher?: string;
    publicationYear?: number;
    categoryId?: number;
    totalCopies?: number;
    shelfLocation?: string;
    description?: string;
  };

  if (!isbn?.trim() || !title?.trim() || !author?.trim() || !categoryId || !shelfLocation?.trim()) {
    res.status(400).json({
      error: 'ISBN, title, author, category, and shelf location are required.',
    });
    return;
  }

  const catId = parsePositiveInt(categoryId);
  const categoryExists = catId ? db.prepare('SELECT id FROM categories WHERE id = ?').get(catId) : undefined;
  if (!catId || !categoryExists) {
    res.status(400).json({ error: 'Please select a valid category.' });
    return;
  }

  const copies = Math.max(1, Number(totalCopies) || 1);
  const existingIsbn = db.prepare('SELECT id FROM books WHERE isbn = ?').get(isbn.trim());
  if (existingIsbn) {
    res.status(409).json({ error: 'A book with this ISBN already exists in the catalog.' });
    return;
  }

  const defaultCovers = [
    '/src/assets/images/cover_computer_science_1795356526685.jpg',
    '/src/assets/images/cover_systems_engineering_1795356527639.jpg',
    '/src/assets/images/cover_humanities_editorial_1795356527177.jpg',
  ];
  const coverUrl = defaultCovers[catId % defaultCovers.length];

  const result = db
    .prepare(
      `INSERT INTO books (
        isbn, title, author, publisher, publication_year, category_id,
        total_copies, available_copies, shelf_location, description, cover_url
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      isbn.trim(),
      title.trim(),
      author.trim(),
      publisher?.trim() || 'Academic Press',
      Number(publicationYear) || 2025,
      Number(categoryId),
      copies,
      copies,
      shelfLocation.trim().toUpperCase(),
      description?.trim() || 'Added to the university library collection.',
      coverUrl
    );

  const created = fetchAllBooks().find((b) => b.id === Number(result.lastInsertRowid));
  res.status(201).json({ book: created });
});

app.put('/api/books/:id', requireAuth, requireRole('LIBRARIAN'), (req, res) => {
  const bookId = Number(req.params.id);
  const existing = db
    .prepare('SELECT id, total_copies, available_copies FROM books WHERE id = ?')
    .get(bookId) as { id: number; total_copies: number; available_copies: number } | undefined;

  if (!existing) {
    res.status(404).json({ error: 'Book not found.' });
    return;
  }

  const {
    isbn,
    title,
    author,
    publisher,
    publicationYear,
    categoryId,
    totalCopies,
    shelfLocation,
    description,
  } = req.body as {
    isbn?: string;
    title?: string;
    author?: string;
    publisher?: string;
    publicationYear?: number;
    categoryId?: number;
    totalCopies?: number;
    shelfLocation?: string;
    description?: string;
  };

  if (!isbn?.trim() || !title?.trim() || !author?.trim() || !categoryId || !shelfLocation?.trim()) {
    res.status(400).json({ error: 'ISBN, title, author, category, and shelf location are required.' });
    return;
  }

  const catId = parsePositiveInt(categoryId);
  const categoryExists = catId ? db.prepare('SELECT id FROM categories WHERE id = ?').get(catId) : undefined;
  if (!catId || !categoryExists) {
    res.status(400).json({ error: 'Please select a valid category.' });
    return;
  }

  const issuedCount = existing.total_copies - existing.available_copies;
  const newTotal = Math.max(issuedCount, Math.max(1, Number(totalCopies) || existing.total_copies));
  const newAvail = newTotal - issuedCount;

  try {
    db.prepare(
      `UPDATE books
       SET isbn = ?, title = ?, author = ?, publisher = ?, publication_year = ?,
           category_id = ?, total_copies = ?, available_copies = ?, shelf_location = ?, description = ?
       WHERE id = ?`
    ).run(
      isbn.trim(),
      title.trim(),
      author.trim(),
      publisher?.trim() || 'Academic Press',
      Number(publicationYear) || 2025,
      Number(categoryId),
      newTotal,
      newAvail,
      shelfLocation.trim().toUpperCase(),
      description?.trim() || '',
      bookId
    );
  } catch {
    res.status(409).json({ error: 'Unable to update book. Ensure ISBN is unique.' });
    return;
  }

  const updated = fetchAllBooks().find((b) => b.id === bookId);
  res.json({ book: updated });
});

app.delete('/api/books/:id', requireAuth, requireRole('LIBRARIAN'), (req, res) => {
  const bookId = Number(req.params.id);
  const activeLoans = db
    .prepare(
      "SELECT COUNT(*) AS count FROM borrow_transactions WHERE book_id = ? AND status IN ('BORROWED', 'OVERDUE', 'PENDING')"
    )
    .get(bookId) as { count: number };

  if (activeLoans.count > 0) {
    res.status(409).json({
      error: 'Cannot delete a book with active loans or pending borrow requests.',
    });
    return;
  }

  const del = db.prepare('DELETE FROM books WHERE id = ?').run(bookId);
  if (del.changes === 0) {
    res.status(404).json({ error: 'Book not found.' });
    return;
  }
  res.json({ deleted: true });
});

// ================= FEATURE 1: INTELLIGENT RECOMMENDATIONS =================
app.get('/api/recommendations', requireAuth, (req: AuthenticatedRequest, res) => {
  const user = req.authUser!;
  const allBooks = fetchAllBooks();
  const history = fetchTransactions(user.id);
  const recommendations = BookRecommendationEngine.recommend(
    allBooks,
    user.interests ?? [],
    history,
    4
  );
  res.json({ recommendations });
});

// ================= BORROW, RETURN, QR SCAN & APPROVALS =================
app.get('/api/transactions', requireAuth, (req: AuthenticatedRequest, res) => {
  const user = req.authUser!;
  const transactions =
    user.role === 'LIBRARIAN' ? fetchTransactions() : fetchTransactions(user.id);
  res.json({ transactions });
});

// Student borrow request or direct QR borrow
app.post('/api/borrow', requireAuth, (req: AuthenticatedRequest, res) => {
  const user = req.authUser!;
  const { bookId, mode } = req.body as { bookId?: number; mode?: 'REQUEST' | 'QR_DIRECT' };

  if (!bookId) {
    res.status(400).json({ error: 'Book ID is required.' });
    return;
  }

  const book = db.prepare('SELECT * FROM books WHERE id = ?').get(bookId) as
    | { id: number; title: string; available_copies: number }
    | undefined;

  if (!book) {
    res.status(404).json({ error: 'Book not found.' });
    return;
  }

  // Prevent duplicate active borrow/request for same book
  const duplicate = db
    .prepare(
      "SELECT id FROM borrow_transactions WHERE book_id = ? AND student_user_id = ? AND status IN ('PENDING', 'BORROWED', 'OVERDUE')"
    )
    .get(bookId, user.id);

  if (duplicate) {
    res.status(409).json({ error: 'You already have an active loan or pending request for this book.' });
    return;
  }

  // Check active borrow limit (5 for students)
  const activeCountRow = db
    .prepare(
      "SELECT COUNT(*) AS count FROM borrow_transactions WHERE student_user_id = ? AND status IN ('PENDING', 'BORROWED', 'OVERDUE')"
    )
    .get(user.id) as { count: number };

  const limit = user.role === 'LIBRARIAN' ? 15 : 5;
  if (activeCountRow.count >= limit) {
    res.status(409).json({
      error: `Borrowing limit reached (${limit} active books/requests maximum). Please return a book first.`,
    });
    return;
  }

  if (book.available_copies <= 0) {
    res.status(409).json({
      error: 'No copies currently available. You can place a reservation to join the waitlist.',
    });
    return;
  }

  const nowIso = new Date().toISOString();
  const isInstant = mode === 'QR_DIRECT';

  try {
    db.exec('BEGIN');
    if (isInstant) {
      const dueDate = FineCalculator.calculateDueDate(nowIso, 14);
      db.prepare('UPDATE books SET available_copies = available_copies - 1 WHERE id = ?').run(bookId);
      const txRes = db
        .prepare(
          `INSERT INTO borrow_transactions (
            book_id, student_user_id, status, requested_at, issued_at, due_date
          ) VALUES (?, ?, 'BORROWED', ?, ?, ?)`
        )
        .run(bookId, user.id, nowIso, nowIso, dueDate);

      // Fulfill waiting reservation if any
      db.prepare(
        "UPDATE reservations SET status = 'FULFILLED' WHERE book_id = ? AND student_user_id = ? AND status IN ('WAITING', 'READY')"
      ).run(bookId, user.id);

      db.exec('COMMIT');
      createNotification(
        user.id,
        `Checked Out: ${book.title}`,
        `Borrowed via QR self-checkout. Return due on ${dueDate.slice(0, 10)}.`,
        'INFO'
      );
      const tx = fetchTransactions(user.id).find((t) => t.id === Number(txRes.lastInsertRowid));
      res.status(201).json({ transaction: tx, instant: true });
      return;
    }

    // Standard borrow (immediately issues if librarian wants approval OR allow direct borrow?
    // Notice prompt: Student Portal: "Borrow and return books", Librarian Portal: "Approve or reject borrowing requests".
    // Let's make QR checkout instant BORROWED, and standard Borrow button support BOTH instant borrow OR pending request toggle?
    // Better UX & satisfies both: let's provide "Borrow Now" (instant issue or request) — wait: in Journey 1:
    // "Click Borrow Book -> Available copies decrement, book appears in My Borrowed Books with calculated 14-day due date."
    // AND in Journey 3: "Approve or reject pending borrow request".
    // Having a clean "Borrow Book" (instant checkout) AND "Request Approval" (or having standard student "Request Borrow" + QR instant borrow, OR seeded pending requests + student option)!
    // Wait: let's look closely at Journey 1:
    // "Click Borrow Book (or scan/submit via QR Scanner page) -> Available copies decrement, book appears in My Borrowed Books with calculated 14-day due date."
    // If "Borrow Book" immediately issues the book (BORROWED) AND "Request Approval" (e.g., for extended loan or reserved hold, plus seeded PENDING requests + optional request mode) creates a PENDING request, then BOTH Journey 1 and Journey 3 work effortlessly and intuitively!
    const dueDate = FineCalculator.calculateDueDate(nowIso, 14);
    if (req.body.requireApproval === true) {
      const txRes = db
        .prepare(
          `INSERT INTO borrow_transactions (book_id, student_user_id, status, requested_at)
           VALUES (?, ?, 'PENDING', ?)`
        )
        .run(bookId, user.id, nowIso);
      db.exec('COMMIT');
      const tx = fetchTransactions(user.id).find((t) => t.id === Number(txRes.lastInsertRowid));
      res.status(201).json({ transaction: tx, instant: false });
      return;
    }

    db.prepare('UPDATE books SET available_copies = available_copies - 1 WHERE id = ?').run(bookId);
    const txRes = db
      .prepare(
        `INSERT INTO borrow_transactions (
          book_id, student_user_id, status, requested_at, issued_at, due_date
        ) VALUES (?, ?, 'BORROWED', ?, ?, ?)`
      )
      .run(bookId, user.id, nowIso, nowIso, dueDate);

    db.prepare(
      "UPDATE reservations SET status = 'FULFILLED' WHERE book_id = ? AND student_user_id = ? AND status IN ('WAITING', 'READY')"
    ).run(bookId, user.id);

    db.exec('COMMIT');
    createNotification(
      user.id,
      `Book Borrowed: ${book.title}`,
      `Your loan is active. Due date: ${dueDate.slice(0, 10)}.`,
      'INFO'
    );
    const tx = fetchTransactions(user.id).find((t) => t.id === Number(txRes.lastInsertRowid));
    res.status(201).json({ transaction: tx, instant: true });
  } catch (err) {
    try {
      db.exec('ROLLBACK');
    } catch {
      // ignore
    }
    res.status(500).json({ error: 'Transaction failed. Please try again.' });
  }
});

// Return a borrowed book
app.post('/api/transactions/:id/return', requireAuth, (req: AuthenticatedRequest, res) => {
  const user = req.authUser!;
  const txId = Number(req.params.id);
  const txRow = db
    .prepare(
      `SELECT bt.*, b.title AS book_title
       FROM borrow_transactions bt
       JOIN books b ON b.id = bt.book_id
       WHERE bt.id = ?`
    )
    .get(txId) as
    | {
        id: number;
        book_id: number;
        student_user_id: number;
        status: string;
        due_date: string | null;
        book_title: string;
      }
    | undefined;

  if (!txRow) {
    res.status(404).json({ error: 'Transaction not found.' });
    return;
  }

  if (user.role !== 'LIBRARIAN' && txRow.student_user_id !== user.id) {
    res.status(403).json({ error: 'You cannot return another student’s loan.' });
    return;
  }

  if (txRow.status !== 'BORROWED' && txRow.status !== 'OVERDUE') {
    res.status(409).json({ error: 'Only currently borrowed or overdue books can be returned.' });
    return;
  }

  const nowIso = new Date().toISOString();
  const overdueDays = txRow.due_date ? FineCalculator.calculateOverdueDays(txRow.due_date, nowIso) : 0;
  const fineAmount = FineCalculator.calculateFineAmount(overdueDays);

  try {
    db.exec('BEGIN');
    db.prepare("UPDATE borrow_transactions SET status = 'RETURNED', returned_at = ? WHERE id = ?").run(
      nowIso,
      txId
    );
    db.prepare(
      'UPDATE books SET available_copies = MIN(total_copies, available_copies + 1) WHERE id = ?'
    ).run(txRow.book_id);

    if (overdueDays > 0) {
      db.prepare(
        `INSERT INTO fines (transaction_id, student_user_id, amount, days_overdue, status, assessed_at)
         VALUES (?, ?, ?, ?, 'UNPAID', ?)
         ON CONFLICT(transaction_id) DO UPDATE SET
           amount = CASE WHEN fines.status = 'UNPAID' THEN excluded.amount ELSE fines.amount END,
           days_overdue = CASE WHEN fines.status = 'UNPAID' THEN excluded.days_overdue ELSE fines.days_overdue END`
      ).run(txId, txRow.student_user_id, fineAmount, overdueDays, nowIso);
    }

    // Notify first waiting reservation if book became available
    const nextWaiter = db
      .prepare(
        "SELECT id, student_user_id FROM reservations WHERE book_id = ? AND status = 'WAITING' ORDER BY id ASC LIMIT 1"
      )
      .get(txRow.book_id) as { id: number; student_user_id: number } | undefined;

    if (nextWaiter) {
      db.prepare("UPDATE reservations SET status = 'READY' WHERE id = ?").run(nextWaiter.id);
      createNotification(
        nextWaiter.student_user_id,
        `Reserved Book Ready: ${txRow.book_title}`,
        `A copy of "${txRow.book_title}" has been returned and is ready for you to borrow.`,
        'RESERVATION'
      );
    }

    db.exec('COMMIT');
    res.json({ returned: true, fineAssessed: fineAmount });
  } catch {
    try {
      db.exec('ROLLBACK');
    } catch {
      // ignore
    }
    res.status(500).json({ error: 'Failed to process book return.' });
  }
});

// Librarian Approve / Reject pending request
app.post('/api/transactions/:id/approve', requireAuth, requireRole('LIBRARIAN'), (req: AuthenticatedRequest, res) => {
  const librarian = req.authUser!;
  const txId = Number(req.params.id);
  const tx = db
    .prepare(
      `SELECT bt.*, b.title, b.available_copies
       FROM borrow_transactions bt
       JOIN books b ON b.id = bt.book_id
       WHERE bt.id = ?`
    )
    .get(txId) as
    | { id: number; book_id: number; student_user_id: number; status: string; title: string; available_copies: number }
    | undefined;

  if (!tx) {
    res.status(404).json({ error: 'Borrow request not found.' });
    return;
  }
  if (tx.status !== 'PENDING') {
    res.status(409).json({ error: 'Only pending requests can be approved.' });
    return;
  }
  if (tx.available_copies <= 0) {
    res.status(409).json({ error: 'No available copies left to issue this book.' });
    return;
  }

  const nowIso = new Date().toISOString();
  const dueDate = FineCalculator.calculateDueDate(nowIso, 14);

  try {
    db.exec('BEGIN');
    db.prepare('UPDATE books SET available_copies = available_copies - 1 WHERE id = ?').run(tx.book_id);
    db.prepare(
      `UPDATE borrow_transactions
       SET status = 'BORROWED', issued_at = ?, due_date = ?, approved_by_user_id = ?
       WHERE id = ?`
    ).run(nowIso, dueDate, librarian.id, txId);
    db.exec('COMMIT');
  } catch {
    try {
      db.exec('ROLLBACK');
    } catch {
      // ignore rollback error
    }
    res.status(500).json({ error: 'Failed to approve borrow request.' });
    return;
  }

  createNotification(
    tx.student_user_id,
    `Borrow Approved: ${tx.title}`,
    `Librarian approved your request for "${tx.title}". Due date: ${dueDate.slice(0, 10)}.`,
    'APPROVAL'
  );

  res.json({ approved: true });
});

app.post('/api/transactions/:id/reject', requireAuth, requireRole('LIBRARIAN'), (req: AuthenticatedRequest, res) => {
  const librarian = req.authUser!;
  const txId = Number(req.params.id);
  const tx = db
    .prepare(
      `SELECT bt.id, bt.status, bt.student_user_id, b.title
       FROM borrow_transactions bt
       JOIN books b ON b.id = bt.book_id
       WHERE bt.id = ?`
    )
    .get(txId) as { id: number; status: string; student_user_id: number; title: string } | undefined;

  if (!tx) {
    res.status(404).json({ error: 'Borrow request not found.' });
    return;
  }
  if (tx.status !== 'PENDING') {
    res.status(409).json({ error: 'Only pending requests can be rejected.' });
    return;
  }

  db.prepare(
    "UPDATE borrow_transactions SET status = 'REJECTED', approved_by_user_id = ? WHERE id = ?"
  ).run(librarian.id, txId);

  createNotification(
    tx.student_user_id,
    `Borrow Request Declined: ${tx.title}`,
    `Your borrowing request for "${tx.title}" was declined by the library desk.`,
    'APPROVAL'
  );

  res.json({ rejected: true });
});

// Feature 2: QR Scan Lookup & Action Validation
app.post('/api/qr/scan', requireAuth, (req: AuthenticatedRequest, res) => {
  const user = req.authUser!;
  const { payload } = req.body as { payload?: string };

  if (!payload?.trim()) {
    res.status(400).json({ error: 'QR code payload or ISBN is required.' });
    return;
  }

  const parsed = QRCodePayloadService.parseBookPayload(payload);
  if (!parsed.valid) {
    res.status(400).json({
      error: 'Unrecognized QR format. Expected SMARTLIB:BOOK:<id>:<isbn> or a valid ISBN.',
    });
    return;
  }

  const allBooks = fetchAllBooks();
  const matchedBook = allBooks.find(
    (b) =>
      (parsed.bookId !== undefined && b.id === parsed.bookId) ||
      (parsed.isbn !== undefined && b.isbn.toLowerCase() === parsed.isbn.toLowerCase())
  );

  if (!matchedBook) {
    res.status(404).json({ error: 'No book in the library catalog matches this QR code.' });
    return;
  }

  const activeUserTx = fetchTransactions(user.id).find(
    (t) =>
      t.bookId === matchedBook.id &&
      (t.status === 'BORROWED' || t.status === 'OVERDUE' || t.status === 'PENDING')
  );

  res.json({
    book: matchedBook,
    activeTransaction: activeUserTx ?? null,
    suggestedAction:
      activeUserTx && (activeUserTx.status === 'BORROWED' || activeUserTx.status === 'OVERDUE')
        ? 'RETURN'
        : matchedBook.availableCopies > 0
          ? 'BORROW'
          : 'RESERVE',
  });
});

// ================= BOOK RESERVATIONS =================
app.get('/api/reservations', requireAuth, (req: AuthenticatedRequest, res) => {
  const user = req.authUser!;
  const where = user.role === 'LIBRARIAN' ? '' : 'WHERE r.student_user_id = ?';
  const rows = db
    .prepare(
      `SELECT r.id, r.book_id, b.title AS book_title, b.author AS book_author, b.isbn AS book_isbn,
              r.student_user_id, u.name AS student_name, r.status, r.reserved_at
       FROM reservations r
       JOIN books b ON b.id = r.book_id
       JOIN users u ON u.id = r.student_user_id
       ${where}
       ORDER BY r.id DESC`
    )
    .all(...(user.role === 'LIBRARIAN' ? [] : [user.id])) as Array<{
    id: number;
    book_id: number;
    book_title: string;
    book_author: string;
    book_isbn: string;
    student_user_id: number;
    student_name: string;
    status: string;
    reserved_at: string;
  }>;

  res.json({
    reservations: rows.map((r) => ({
      id: r.id,
      bookId: r.book_id,
      bookTitle: r.book_title,
      bookAuthor: r.book_author,
      bookIsbn: r.book_isbn,
      studentUserId: r.student_user_id,
      studentName: r.student_name,
      status: r.status,
      reservedAt: r.reserved_at,
    })),
  });
});

app.post('/api/reservations', requireAuth, (req: AuthenticatedRequest, res) => {
  const user = req.authUser!;
  const { bookId } = req.body as { bookId?: number };
  if (!bookId) {
    res.status(400).json({ error: 'Book ID is required.' });
    return;
  }

  const book = db.prepare('SELECT id, title, available_copies FROM books WHERE id = ?').get(bookId) as
    | { id: number; title: string; available_copies: number }
    | undefined;

  if (!book) {
    res.status(404).json({ error: 'Book not found.' });
    return;
  }

  if (book.available_copies > 0) {
    res.status(409).json({ error: 'Copies are currently available. You can borrow this book directly.' });
    return;
  }

  const existing = db
    .prepare(
      "SELECT id FROM reservations WHERE book_id = ? AND student_user_id = ? AND status IN ('WAITING', 'READY')"
    )
    .get(bookId, user.id);

  if (existing) {
    res.status(409).json({ error: 'You have already reserved this book.' });
    return;
  }

  const nowIso = new Date().toISOString();
  const r = db
    .prepare(
      "INSERT INTO reservations (book_id, student_user_id, status, reserved_at) VALUES (?, ?, 'WAITING', ?)"
    )
    .run(bookId, user.id, nowIso);

  createNotification(
    user.id,
    `Waitlist Confirmed: ${book.title}`,
    `You are in the reservation queue for "${book.title}". We will notify you as soon as a copy is returned.`,
    'RESERVATION'
  );

  res.status(201).json({ reservationId: Number(r.lastInsertRowid) });
});

app.delete('/api/reservations/:id', requireAuth, (req: AuthenticatedRequest, res) => {
  const user = req.authUser!;
  const resId = Number(req.params.id);
  const existing = db
    .prepare('SELECT id, student_user_id FROM reservations WHERE id = ?')
    .get(resId) as { id: number; student_user_id: number } | undefined;

  if (!existing) {
    res.status(404).json({ error: 'Reservation not found.' });
    return;
  }
  if (user.role !== 'LIBRARIAN' && existing.student_user_id !== user.id) {
    res.status(403).json({ error: 'Unauthorized.' });
    return;
  }

  db.prepare("UPDATE reservations SET status = 'CANCELLED' WHERE id = ?").run(resId);
  res.json({ cancelled: true });
});

// ================= FEATURE 3: FINES & NOTIFICATIONS =================
app.get('/api/fines', requireAuth, (req: AuthenticatedRequest, res) => {
  syncOverdueAndAlerts();
  const user = req.authUser!;
  const where = user.role === 'LIBRARIAN' ? '' : 'WHERE f.student_user_id = ?';
  const rows = db
    .prepare(
      `SELECT f.*, b.title AS book_title, u.name AS student_name,
              COALESCE(s.enrollment_number, 'LIB') AS enrollment_number
       FROM fines f
       JOIN borrow_transactions bt ON bt.id = f.transaction_id
       JOIN books b ON b.id = bt.book_id
       JOIN users u ON u.id = f.student_user_id
       LEFT JOIN students s ON s.user_id = u.id
       ${where}
       ORDER BY f.id DESC`
    )
    .all(...(user.role === 'LIBRARIAN' ? [] : [user.id])) as Array<{
    id: number;
    transaction_id: number;
    book_title: string;
    student_user_id: number;
    student_name: string;
    enrollment_number: string;
    amount: number;
    days_overdue: number;
    status: string;
    assessed_at: string;
    paid_at: string | null;
  }>;

  res.json({
    fines: rows.map((f) => ({
      id: f.id,
      transactionId: f.transaction_id,
      bookTitle: f.book_title,
      studentUserId: f.student_user_id,
      studentName: f.student_name,
      enrollmentNumber: f.enrollment_number,
      amount: f.amount,
      daysOverdue: f.days_overdue,
      status: f.status,
      assessedAt: f.assessed_at,
      paidAt: f.paid_at,
    })),
  });
});

app.post('/api/fines/:id/pay', requireAuth, (req: AuthenticatedRequest, res) => {
  const user = req.authUser!;
  const fineId = Number(req.params.id);
  const fine = db
    .prepare('SELECT id, student_user_id, status, amount FROM fines WHERE id = ?')
    .get(fineId) as { id: number; student_user_id: number; status: string; amount: number } | undefined;

  if (!fine) {
    res.status(404).json({ error: 'Fine record not found.' });
    return;
  }
  if (user.role !== 'LIBRARIAN' && fine.student_user_id !== user.id) {
    res.status(403).json({ error: 'Unauthorized.' });
    return;
  }
  if (fine.status !== 'UNPAID') {
    res.status(409).json({ error: 'This fine has already been settled.' });
    return;
  }

  const nowIso = new Date().toISOString();
  db.prepare("UPDATE fines SET status = 'PAID', paid_at = ? WHERE id = ?").run(nowIso, fineId);
  createNotification(
    fine.student_user_id,
    'Fine Payment Recorded',
    `Payment of ₹${fine.amount.toFixed(2)} has been recorded and cleared from your account.`,
    'FINE'
  );
  res.json({ paid: true });
});

// ================= DIGITAL LIBRARY REPOSITORY =================
function fetchDigitalResourcesForUser(userId: number): DigitalResource[] {
  const rows = db
    .prepare(
      `SELECT dr.*, c.name AS category_name,
              COALESCE(dbm.is_bookmarked, 0) AS is_bookmarked,
              COALESCE(dbm.last_chapter, 0) AS last_chapter
       FROM digital_resources dr
       JOIN categories c ON c.id = dr.category_id
       LEFT JOIN digital_bookmarks dbm ON dbm.resource_id = dr.id AND dbm.user_id = ?
       ORDER BY dr.id DESC`
    )
    .all(userId) as Array<{
    id: number;
    title: string;
    author: string;
    category_id: number;
    category_name: string;
    resource_type: DigitalResourceType;
    publication_year: number;
    page_count: number;
    file_format: 'PDF' | 'EPUB';
    summary: string;
    chapters_json: string;
    download_count: number;
    read_count: number;
    is_bookmarked: number;
    last_chapter: number;
    created_at: string;
  }>;

  return rows.map((r) => {
    let chapters: DigitalChapter[] = [];
    try {
      const parsed = JSON.parse(r.chapters_json || '[]') as DigitalChapter[];
      if (Array.isArray(parsed)) {
        chapters = parsed;
      }
    } catch {
      chapters = [];
    }
    return {
      id: r.id,
      title: r.title,
      author: r.author,
      categoryId: r.category_id,
      categoryName: r.category_name,
      resourceType: r.resource_type,
      publicationYear: r.publication_year,
      pageCount: r.page_count,
      fileFormat: r.file_format,
      summary: r.summary,
      chapters,
      downloadCount: r.download_count,
      readCount: r.read_count,
      isBookmarked: r.is_bookmarked === 1,
      lastChapter: r.last_chapter,
      createdAt: r.created_at,
    };
  });
}

app.get('/api/digital-resources', requireAuth, (req: AuthenticatedRequest, res) => {
  const resources = fetchDigitalResourcesForUser(req.authUser!.id);
  res.json({ resources });
});

app.post('/api/digital-resources', requireAuth, requireRole('LIBRARIAN'), (req: AuthenticatedRequest, res) => {
  const {
    title,
    author,
    categoryId,
    resourceType,
    publicationYear,
    pageCount,
    fileFormat,
    summary,
    chapters,
  } = req.body as {
    title?: string;
    author?: string;
    categoryId?: number;
    resourceType?: DigitalResourceType;
    publicationYear?: number;
    pageCount?: number;
    fileFormat?: 'PDF' | 'EPUB';
    summary?: string;
    chapters?: DigitalChapter[];
  };

  if (!title?.trim() || !author?.trim() || !categoryId || !summary?.trim()) {
    res.status(400).json({ error: 'Title, author, category, and abstract summary are required.' });
    return;
  }

  const catId = parsePositiveInt(categoryId);
  const categoryExists = catId ? db.prepare('SELECT id FROM categories WHERE id = ?').get(catId) : undefined;
  if (!catId || !categoryExists) {
    res.status(400).json({ error: 'Please select a valid category.' });
    return;
  }

  const validTypes: DigitalResourceType[] = ['EBOOK', 'RESEARCH_PAPER', 'JOURNAL', 'LECTURE_NOTES'];
  const safeType: DigitalResourceType = validTypes.includes(resourceType as DigitalResourceType)
    ? (resourceType as DigitalResourceType)
    : 'EBOOK';
  const safeFormat: 'PDF' | 'EPUB' = fileFormat === 'EPUB' ? 'EPUB' : 'PDF';

  const cleanedChapters: DigitalChapter[] = Array.isArray(chapters)
    ? chapters
        .filter((c) => c && typeof c.title === 'string' && typeof c.body === 'string' && c.title.trim() && c.body.trim())
        .map((c) => ({ title: c.title.trim(), body: c.body.trim() }))
    : [];

  if (cleanedChapters.length === 0) {
    cleanedChapters.push({
      title: '1. Overview & Key Concepts',
      body: summary.trim(),
    });
  }

  const result = db
    .prepare(
      `INSERT INTO digital_resources (
        title, author, category_id, resource_type, publication_year, page_count,
        file_format, summary, chapters_json, download_count, read_count
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 0)`
    )
    .run(
      title.trim(),
      author.trim(),
      catId,
      safeType,
      Number(publicationYear) || 2026,
      Math.max(1, Number(pageCount) || 24),
      safeFormat,
      summary.trim(),
      JSON.stringify(cleanedChapters)
    );

  const created = fetchDigitalResourcesForUser(req.authUser!.id).find(
    (r) => r.id === Number(result.lastInsertRowid)
  );
  res.status(201).json({ resource: created });
});

app.delete('/api/digital-resources/:id', requireAuth, requireRole('LIBRARIAN'), (req, res) => {
  const resourceId = Number(req.params.id);
  const del = db.prepare('DELETE FROM digital_resources WHERE id = ?').run(resourceId);
  if (del.changes === 0) {
    res.status(404).json({ error: 'Digital resource not found.' });
    return;
  }
  res.json({ deleted: true });
});

app.post('/api/digital-resources/:id/read', requireAuth, (req: AuthenticatedRequest, res) => {
  const resourceId = Number(req.params.id);
  const userId = req.authUser!.id;
  const { chapterIndex, incrementRead } = (req.body || {}) as {
    chapterIndex?: number;
    incrementRead?: boolean;
  };

  const row = db
    .prepare('SELECT id, chapters_json, read_count FROM digital_resources WHERE id = ?')
    .get(resourceId) as { id: number; chapters_json: string; read_count: number } | undefined;

  if (!row) {
    res.status(404).json({ error: 'Digital resource not found.' });
    return;
  }

  let totalChapters = 1;
  try {
    const parsed = JSON.parse(row.chapters_json || '[]') as DigitalChapter[];
    if (Array.isArray(parsed) && parsed.length > 0) totalChapters = parsed.length;
  } catch {
    totalChapters = 1;
  }

  const clampedChapter = Math.max(0, Math.min(totalChapters - 1, Number(chapterIndex) || 0));

  if (incrementRead !== false) {
    db.prepare('UPDATE digital_resources SET read_count = read_count + 1 WHERE id = ?').run(resourceId);
  }

  db.prepare(
    `INSERT INTO digital_bookmarks (resource_id, user_id, is_bookmarked, last_chapter, updated_at)
     VALUES (?, ?, 0, ?, datetime('now'))
     ON CONFLICT(resource_id, user_id) DO UPDATE SET
       last_chapter = excluded.last_chapter,
       updated_at = datetime('now')`
  ).run(resourceId, userId, clampedChapter);

  const updated = db.prepare('SELECT read_count FROM digital_resources WHERE id = ?').get(resourceId) as {
    read_count: number;
  };
  res.json({ readCount: updated.read_count, lastChapter: clampedChapter });
});

app.post('/api/digital-resources/:id/bookmark', requireAuth, (req: AuthenticatedRequest, res) => {
  const resourceId = Number(req.params.id);
  const userId = req.authUser!.id;

  const exists = db.prepare('SELECT id FROM digital_resources WHERE id = ?').get(resourceId);
  if (!exists) {
    res.status(404).json({ error: 'Digital resource not found.' });
    return;
  }

  const current = db
    .prepare('SELECT is_bookmarked FROM digital_bookmarks WHERE resource_id = ? AND user_id = ?')
    .get(resourceId, userId) as { is_bookmarked: number } | undefined;

  const nextState = current && current.is_bookmarked === 1 ? 0 : 1;

  db.prepare(
    `INSERT INTO digital_bookmarks (resource_id, user_id, is_bookmarked, last_chapter, updated_at)
     VALUES (?, ?, ?, 0, datetime('now'))
     ON CONFLICT(resource_id, user_id) DO UPDATE SET
       is_bookmarked = excluded.is_bookmarked,
       updated_at = datetime('now')`
  ).run(resourceId, userId, nextState);

  res.json({ isBookmarked: nextState === 1 });
});

app.post('/api/digital-resources/:id/download', requireAuth, (req, res) => {
  const resourceId = Number(req.params.id);
  const upd = db
    .prepare('UPDATE digital_resources SET download_count = download_count + 1 WHERE id = ?')
    .run(resourceId);
  if (upd.changes === 0) {
    res.status(404).json({ error: 'Digital resource not found.' });
    return;
  }
  const row = db
    .prepare('SELECT download_count FROM digital_resources WHERE id = ?')
    .get(resourceId) as { download_count: number };
  res.json({ downloadCount: row.download_count });
});

app.get('/api/notifications', requireAuth, (req: AuthenticatedRequest, res) => {
  syncOverdueAndAlerts();
  const rows = db
    .prepare(
      'SELECT id, user_id, title, message, type, is_read, created_at FROM notifications WHERE user_id = ? ORDER BY id DESC LIMIT 20'
    )
    .all(req.authUser!.id) as Array<{
    id: number;
    user_id: number;
    title: string;
    message: string;
    type: string;
    is_read: number;
    created_at: string;
  }>;

  res.json({
    notifications: rows.map((n) => ({
      id: n.id,
      userId: n.user_id,
      title: n.title,
      message: n.message,
      type: n.type,
      isRead: n.is_read === 1,
      createdAt: n.created_at,
    })),
  });
});

app.post('/api/notifications/:id/read', requireAuth, (req: AuthenticatedRequest, res) => {
  db.prepare('UPDATE notifications SET is_read = 1 WHERE id = ? AND user_id = ?').run(
    Number(req.params.id),
    req.authUser!.id
  );
  res.json({ read: true });
});

// ================= FEATURE 4: SMART LIBRARY SEAT RESERVATION =================
app.get('/api/seats', requireAuth, (req: AuthenticatedRequest, res) => {
  const user = req.authUser!;
  const bookingDate =
    typeof req.query.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(req.query.date)
      ? req.query.date
      : getLocalDateStr();
  const timeSlot =
    typeof req.query.timeSlot === 'string' &&
    (LIBRARY_TIME_SLOTS as readonly string[]).includes(req.query.timeSlot)
      ? req.query.timeSlot
      : LIBRARY_TIME_SLOTS[1];

  const seats = db
    .prepare('SELECT id, seat_code, floor, zone, has_power_outlet, is_quiet_zone FROM library_seats ORDER BY seat_code ASC')
    .all() as Array<{
    id: number;
    seat_code: string;
    floor: string;
    zone: string;
    has_power_outlet: number;
    is_quiet_zone: number;
  }>;

  const slotBookings = db
    .prepare(
      `SELECT sb.id, sb.seat_id, sb.student_user_id, u.name AS student_name
       FROM seat_bookings sb
       JOIN users u ON u.id = sb.student_user_id
       WHERE sb.booking_date = ? AND sb.time_slot = ? AND sb.status = 'ACTIVE'`
    )
    .all(bookingDate, timeSlot) as Array<{
    id: number;
    seat_id: number;
    student_user_id: number;
    student_name: string;
  }>;

  const bookingMap = new Map(slotBookings.map((b) => [b.seat_id, b]));

  const myBookingsRows = db
    .prepare(
      `SELECT sb.*, ls.seat_code, ls.floor, ls.zone, u.name AS student_name,
              COALESCE(s.enrollment_number, 'LIB') AS enrollment_number
       FROM seat_bookings sb
       JOIN library_seats ls ON ls.id = sb.seat_id
       JOIN users u ON u.id = sb.student_user_id
       LEFT JOIN students s ON s.user_id = u.id
       ${user.role === 'LIBRARIAN' ? '' : 'WHERE sb.student_user_id = ?'}
       ORDER BY sb.id DESC`
    )
    .all(...(user.role === 'LIBRARIAN' ? [] : [user.id])) as Array<{
    id: number;
    seat_id: number;
    seat_code: string;
    floor: string;
    zone: string;
    student_user_id: number;
    student_name: string;
    enrollment_number: string;
    booking_date: string;
    time_slot: string;
    status: SeatBooking['status'];
    created_at: string;
  }>;

  res.json({
    bookingDate,
    timeSlot,
    timeSlots: LIBRARY_TIME_SLOTS,
    seats: seats.map((s) => {
      const active = bookingMap.get(s.id);
      return {
        id: s.id,
        seatCode: s.seat_code,
        floor: s.floor,
        zone: s.zone,
        hasPowerOutlet: s.has_power_outlet === 1,
        isQuietZone: s.is_quiet_zone === 1,
        isAvailableForSlot: !active,
        bookedByCurrentUser: active ? active.student_user_id === user.id : false,
        bookedByName: active
          ? user.role === 'LIBRARIAN' || active.student_user_id === user.id
            ? active.student_name
            : 'Occupied'
          : null,
        currentBookingId: active ? active.id : null,
      };
    }),
    bookings: myBookingsRows.map((b) => ({
      id: b.id,
      seatId: b.seat_id,
      seatCode: b.seat_code,
      floor: b.floor,
      zone: b.zone,
      studentUserId: b.student_user_id,
      studentName: b.student_name,
      enrollmentNumber: b.enrollment_number,
      bookingDate: b.booking_date,
      timeSlot: b.time_slot,
      status: b.status,
      createdAt: b.created_at,
    })),
  });
});

app.post('/api/seats/book', requireAuth, (req: AuthenticatedRequest, res) => {
  const user = req.authUser!;
  const { seatId, bookingDate, timeSlot } = req.body as {
    seatId?: number;
    bookingDate?: string;
    timeSlot?: string;
  };

  if (!seatId || !bookingDate || !timeSlot) {
    res.status(400).json({ error: 'Seat, date, and time slot are required.' });
    return;
  }

  if (!(LIBRARY_TIME_SLOTS as readonly string[]).includes(timeSlot)) {
    res.status(400).json({ error: 'Invalid library time slot.' });
    return;
  }

  const seat = db.prepare('SELECT id, seat_code FROM library_seats WHERE id = ?').get(seatId) as
    | { id: number; seat_code: string }
    | undefined;
  if (!seat) {
    res.status(404).json({ error: 'Seat not found.' });
    return;
  }

  const existingActive = db
    .prepare(
      "SELECT seat_id AS seatId, student_user_id AS studentUserId, booking_date AS bookingDate, time_slot AS timeSlot, status FROM seat_bookings WHERE booking_date = ? AND time_slot = ? AND status = 'ACTIVE'"
    )
    .all(bookingDate, timeSlot) as Pick<
    SeatBooking,
    'seatId' | 'studentUserId' | 'bookingDate' | 'timeSlot' | 'status'
  >[];

  const conflict = SeatReservationValidator.hasSlotConflict(
    existingActive,
    seatId,
    user.id,
    bookingDate,
    timeSlot
  );

  if (conflict.conflict) {
    res.status(409).json({ error: conflict.reason });
    return;
  }

  const nowIso = new Date().toISOString();
  const r = db
    .prepare(
      "INSERT INTO seat_bookings (seat_id, student_user_id, booking_date, time_slot, status, created_at) VALUES (?, ?, ?, ?, 'ACTIVE', ?)"
    )
    .run(seatId, user.id, bookingDate, timeSlot, nowIso);

  createNotification(
    user.id,
    `Seat Reserved: ${seat.seat_code}`,
    `Your seat ${seat.seat_code} is booked for ${bookingDate} (${timeSlot}).`,
    'SEAT'
  );

  res.status(201).json({ bookingId: Number(r.lastInsertRowid) });
});

app.delete('/api/seats/bookings/:id', requireAuth, (req: AuthenticatedRequest, res) => {
  const user = req.authUser!;
  const bookingId = Number(req.params.id);
  const existing = db
    .prepare('SELECT id, student_user_id, status FROM seat_bookings WHERE id = ?')
    .get(bookingId) as { id: number; student_user_id: number; status: string } | undefined;

  if (!existing) {
    res.status(404).json({ error: 'Seat booking not found.' });
    return;
  }

  if (user.role !== 'LIBRARIAN' && existing.student_user_id !== user.id) {
    res.status(403).json({ error: 'You can only cancel your own seat reservations.' });
    return;
  }

  db.prepare("UPDATE seat_bookings SET status = 'CANCELLED' WHERE id = ?").run(bookingId);
  res.json({ cancelled: true });
});

// ================= LIBRARIAN: STUDENT MANAGEMENT & ANALYTICS =================
app.get('/api/students', requireAuth, requireRole('LIBRARIAN'), (_req, res) => {
  syncOverdueAndAlerts();
  const rows = db
    .prepare(
      `SELECT u.id, u.name, u.email, u.active, u.created_at,
              s.enrollment_number, s.department, s.semester, s.interests_json,
              (SELECT COUNT(*) FROM borrow_transactions bt WHERE bt.student_user_id = u.id AND bt.status IN ('BORROWED', 'OVERDUE')) AS active_borrows,
              (SELECT COALESCE(SUM(f.amount), 0) FROM fines f WHERE f.student_user_id = u.id AND f.status = 'UNPAID') AS unpaid_fines
       FROM users u
       JOIN students s ON s.user_id = u.id
       ORDER BY u.id DESC`
    )
    .all() as Array<{
    id: number;
    name: string;
    email: string;
    active: number;
    created_at: string;
    enrollment_number: string;
    department: string;
    semester: number;
    interests_json: string;
    active_borrows: number;
    unpaid_fines: number;
  }>;

  res.json({
    students: rows.map((r) => ({
      id: r.id,
      name: r.name,
      email: r.email,
      active: r.active === 1,
      createdAt: r.created_at,
      enrollmentNumber: r.enrollment_number,
      department: r.department,
      semester: r.semester,
      interests: JSON.parse(r.interests_json || '[]') as string[],
      activeBorrows: r.active_borrows,
      unpaidFines: r.unpaid_fines,
    })),
  });
});

app.patch('/api/students/:id/status', requireAuth, requireRole('LIBRARIAN'), (req, res) => {
  const studentId = Number(req.params.id);
  const { active } = req.body as { active?: boolean };
  if (typeof active !== 'boolean') {
    res.status(400).json({ error: 'Active boolean flag is required.' });
    return;
  }
  const r = db
    .prepare("UPDATE users SET active = ? WHERE id = ? AND role = 'STUDENT'")
    .run(active ? 1 : 0, studentId);

  if (r.changes === 0) {
    res.status(404).json({ error: 'Student account not found.' });
    return;
  }
  res.json({ updated: true });
});

app.get('/api/analytics', requireAuth, requireRole('LIBRARIAN'), (_req, res) => {
  syncOverdueAndAlerts();

  const bookAgg = db
    .prepare(
      `SELECT COUNT(*) AS totalBooks,
              COALESCE(SUM(total_copies), 0) AS totalCopies,
              COALESCE(SUM(available_copies), 0) AS availableCopies
       FROM books`
    )
    .get() as { totalBooks: number; totalCopies: number; availableCopies: number };

  const overdueCount = (
    db.prepare("SELECT COUNT(*) AS c FROM borrow_transactions WHERE status = 'OVERDUE'").get() as {
      c: number;
    }
  ).c;
  const pendingRequests = (
    db.prepare("SELECT COUNT(*) AS c FROM borrow_transactions WHERE status = 'PENDING'").get() as {
      c: number;
    }
  ).c;
  const activeStudents = (
    db.prepare("SELECT COUNT(*) AS c FROM users WHERE role = 'STUDENT' AND active = 1").get() as {
      c: number;
    }
  ).c;
  const unpaidFinesTotal = (
    db.prepare("SELECT COALESCE(SUM(amount), 0) AS total FROM fines WHERE status = 'UNPAID'").get() as {
      total: number;
    }
  ).total;
  const activeSeatBookings = (
    db.prepare("SELECT COUNT(*) AS c FROM seat_bookings WHERE status = 'ACTIVE'").get() as { c: number }
  ).c;

  const mostBorrowedBooks = db
    .prepare(
      `SELECT b.id AS bookId, b.title, b.author, c.name AS categoryName,
              COUNT(bt.id) AS borrowCount
       FROM books b
       JOIN categories c ON c.id = b.category_id
       LEFT JOIN borrow_transactions bt ON bt.book_id = b.id AND bt.status != 'REJECTED'
       GROUP BY b.id
       ORDER BY borrowCount DESC, b.title ASC
       LIMIT 6`
    )
    .all() as AnalyticsReport['mostBorrowedBooks'];

  const mostActiveStudents = db
    .prepare(
      `SELECT u.id AS userId, u.name, s.enrollment_number AS enrollmentNumber,
              s.department, COUNT(bt.id) AS borrowCount
       FROM users u
       JOIN students s ON s.user_id = u.id
       LEFT JOIN borrow_transactions bt ON bt.student_user_id = u.id AND bt.status != 'REJECTED'
       GROUP BY u.id
       ORDER BY borrowCount DESC, u.name ASC
       LIMIT 6`
    )
    .all() as AnalyticsReport['mostActiveStudents'];

  // Build 6-month borrowing & return series dynamically from SQLite timestamps
  const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const allTx = db
    .prepare("SELECT requested_at, returned_at, status FROM borrow_transactions WHERE status != 'REJECTED'")
    .all() as Array<{ requested_at: string; returned_at: string | null; status: string }>;

  const months: Array<{ key: string; label: string; borrows: number; returns: number }> = [];
  const now = new Date();
  for (let i = 5; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    months.push({
      key,
      label: `${monthNames[d.getMonth()]} ${String(d.getFullYear()).slice(2)}`,
      borrows: 0,
      returns: 0,
    });
  }

  for (const tx of allTx) {
    const reqMonth = tx.requested_at.slice(0, 7);
    const m1 = months.find((m) => m.key === reqMonth);
    if (m1) m1.borrows += 1;
    if (tx.returned_at) {
      const retMonth = tx.returned_at.slice(0, 7);
      const m2 = months.find((m) => m.key === retMonth);
      if (m2) m2.returns += 1;
    }
  }

  const categoryBreakdown = db
    .prepare(
      `SELECT c.name AS categoryName,
              COUNT(DISTINCT b.id) AS bookCount,
              COUNT(bt.id) AS borrowCount
       FROM categories c
       LEFT JOIN books b ON b.category_id = c.id
       LEFT JOIN borrow_transactions bt ON bt.book_id = b.id AND bt.status != 'REJECTED'
       GROUP BY c.id
       ORDER BY borrowCount DESC, bookCount DESC`
    )
    .all() as AnalyticsReport['categoryBreakdown'];

  const digitalAgg = db
    .prepare(
      `SELECT COUNT(*) AS totalDigitalResources,
              COALESCE(SUM(read_count), 0) AS totalDigitalReads
       FROM digital_resources`
    )
    .get() as { totalDigitalResources: number; totalDigitalReads: number };

  const report: AnalyticsReport = {
    totals: {
      totalBooks: bookAgg.totalBooks,
      totalCopies: bookAgg.totalCopies,
      availableCopies: bookAgg.availableCopies,
      issuedCopies: bookAgg.totalCopies - bookAgg.availableCopies,
      overdueCount,
      pendingRequests,
      activeStudents,
      unpaidFinesTotal: Number(unpaidFinesTotal.toFixed(2)),
      activeSeatBookings,
      totalDigitalResources: digitalAgg.totalDigitalResources,
      totalDigitalReads: digitalAgg.totalDigitalReads,
    },
    mostBorrowedBooks,
    mostActiveStudents,
    monthlyBorrowing: months.map((m) => ({
      month: m.key,
      label: m.label,
      borrows: m.borrows,
      returns: m.returns,
    })),
    categoryBreakdown,
  };

  res.json({ report });
});

// ================= VITE / STATIC FRONTEND SERVING =================
async function startServer() {
  const isProd = process.env.NODE_ENV === 'production' && fs.existsSync(path.resolve('dist/index.html'));

  if (!isProd) {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    app.use(express.static(path.resolve('dist')));
    app.get('*', (_req, res) => {
      res.sendFile(path.resolve('dist/index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Smart Library Management System listening on http://0.0.0.0:${PORT}`);
  });
}

startServer();
