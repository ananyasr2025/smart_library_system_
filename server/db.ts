import crypto from 'node:crypto';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import {
  FineCalculator,
  QRCodePayloadService,
} from '../src/domain/LibraryOOP.ts';

const DB_FILE = process.env.DB_PATH || path.resolve(process.cwd(), 'smart_library.db');

export const db = new DatabaseSync(DB_FILE);
db.exec('PRAGMA foreign_keys = ON;');
db.exec('PRAGMA journal_mode = WAL;');

export function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16).toString('hex');
  const derived = crypto.scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${derived}`;
}

export function verifyPassword(password: string, storedHash: string): boolean {
  const parts = storedHash.split(':');
  if (parts.length !== 2) return false;
  const [salt, originalHex] = parts;
  const derivedBuf = crypto.scryptSync(password, salt, 64);
  const originalBuf = Buffer.from(originalHex, 'hex');
  if (derivedBuf.length !== originalBuf.length) return false;
  return crypto.timingSafeEqual(derivedBuf, originalBuf);
}

export function initDatabase(): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      email TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      role TEXT NOT NULL CHECK (role IN ('STUDENT', 'LIBRARIAN')),
      active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS students (
      user_id INTEGER PRIMARY KEY,
      enrollment_number TEXT NOT NULL UNIQUE,
      department TEXT NOT NULL,
      semester INTEGER NOT NULL DEFAULT 1,
      interests_json TEXT NOT NULL DEFAULT '[]',
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS librarians (
      user_id INTEGER PRIMARY KEY,
      employee_id TEXT NOT NULL UNIQUE,
      office_hours TEXT NOT NULL DEFAULT '09:00 AM - 05:00 PM',
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS categories (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      description TEXT NOT NULL DEFAULT ''
    );

    CREATE TABLE IF NOT EXISTS books (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      isbn TEXT NOT NULL UNIQUE,
      title TEXT NOT NULL,
      author TEXT NOT NULL,
      publisher TEXT NOT NULL DEFAULT 'Academic Press',
      publication_year INTEGER NOT NULL DEFAULT 2024,
      category_id INTEGER NOT NULL,
      total_copies INTEGER NOT NULL CHECK (total_copies >= 1),
      available_copies INTEGER NOT NULL CHECK (available_copies >= 0),
      shelf_location TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      cover_url TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (category_id) REFERENCES categories(id)
    );

    CREATE TABLE IF NOT EXISTS borrow_transactions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      book_id INTEGER NOT NULL,
      student_user_id INTEGER NOT NULL,
      status TEXT NOT NULL CHECK (status IN ('PENDING', 'BORROWED', 'RETURNED', 'REJECTED', 'OVERDUE')),
      requested_at TEXT NOT NULL,
      issued_at TEXT,
      due_date TEXT,
      returned_at TEXT,
      approved_by_user_id INTEGER,
      FOREIGN KEY (book_id) REFERENCES books(id) ON DELETE CASCADE,
      FOREIGN KEY (student_user_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY (approved_by_user_id) REFERENCES users(id)
    );

    CREATE TABLE IF NOT EXISTS reservations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      book_id INTEGER NOT NULL,
      student_user_id INTEGER NOT NULL,
      status TEXT NOT NULL CHECK (status IN ('WAITING', 'READY', 'FULFILLED', 'CANCELLED')),
      reserved_at TEXT NOT NULL,
      FOREIGN KEY (book_id) REFERENCES books(id) ON DELETE CASCADE,
      FOREIGN KEY (student_user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS fines (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      transaction_id INTEGER NOT NULL UNIQUE,
      student_user_id INTEGER NOT NULL,
      amount REAL NOT NULL CHECK (amount >= 0),
      days_overdue INTEGER NOT NULL DEFAULT 0,
      status TEXT NOT NULL CHECK (status IN ('UNPAID', 'PAID', 'WAIVED')),
      assessed_at TEXT NOT NULL,
      paid_at TEXT,
      FOREIGN KEY (transaction_id) REFERENCES borrow_transactions(id) ON DELETE CASCADE,
      FOREIGN KEY (student_user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS library_seats (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      seat_code TEXT NOT NULL UNIQUE,
      floor TEXT NOT NULL,
      zone TEXT NOT NULL,
      has_power_outlet INTEGER NOT NULL DEFAULT 1,
      is_quiet_zone INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS seat_bookings (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      seat_id INTEGER NOT NULL,
      student_user_id INTEGER NOT NULL,
      booking_date TEXT NOT NULL,
      time_slot TEXT NOT NULL,
      status TEXT NOT NULL CHECK (status IN ('ACTIVE', 'CANCELLED', 'COMPLETED')),
      created_at TEXT NOT NULL,
      FOREIGN KEY (seat_id) REFERENCES library_seats(id) ON DELETE CASCADE,
      FOREIGN KEY (student_user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS notifications (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      title TEXT NOT NULL,
      message TEXT NOT NULL,
      type TEXT NOT NULL,
      is_read INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS digital_resources (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      author TEXT NOT NULL,
      category_id INTEGER NOT NULL,
      resource_type TEXT NOT NULL CHECK (resource_type IN ('EBOOK', 'RESEARCH_PAPER', 'JOURNAL', 'LECTURE_NOTES')),
      publication_year INTEGER NOT NULL DEFAULT 2025,
      page_count INTEGER NOT NULL DEFAULT 40,
      file_format TEXT NOT NULL CHECK (file_format IN ('PDF', 'EPUB')) DEFAULT 'PDF',
      summary TEXT NOT NULL DEFAULT '',
      chapters_json TEXT NOT NULL DEFAULT '[]',
      download_count INTEGER NOT NULL DEFAULT 0,
      read_count INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (category_id) REFERENCES categories(id)
    );

    CREATE TABLE IF NOT EXISTS digital_bookmarks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      resource_id INTEGER NOT NULL,
      user_id INTEGER NOT NULL,
      is_bookmarked INTEGER NOT NULL DEFAULT 0,
      last_chapter INTEGER NOT NULL DEFAULT 0,
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(resource_id, user_id),
      FOREIGN KEY (resource_id) REFERENCES digital_resources(id) ON DELETE CASCADE,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );
  `);

  const userCountRow = db.prepare('SELECT COUNT(*) as count FROM users').get() as { count: number };
  if (userCountRow.count === 0) {
    seedDatabase();
  }

  const digitalCountRow = db
    .prepare('SELECT COUNT(*) as count FROM digital_resources')
    .get() as { count: number };
  if (digitalCountRow.count === 0) {
    seedDigitalResources();
  }

  // Ensure existing unpaid fines and alerts reflect ₹10/day Rupee currency
  db.exec(`
    UPDATE notifications
    SET message = REPLACE(REPLACE(message, '$1.50/day', '₹10.00/day'), '$6.00', '₹40.00')
    WHERE message LIKE '%$%';
  `);
}

function seedDigitalResources(): void {
  const categories = db.prepare('SELECT id, name FROM categories').all() as Array<{
    id: number;
    name: string;
  }>;
  const catMap = new Map(categories.map((c) => [c.name, c.id]));
  const fallbackCat = categories[0]?.id ?? 1;

  const insertDigital = db.prepare(`
    INSERT INTO digital_resources (
      title, author, category_id, resource_type, publication_year, page_count,
      file_format, summary, chapters_json, download_count, read_count
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const digitalSeeds = [
    {
      title: 'Object-Oriented Architecture & Design Patterns in Java',
      author: 'Prof. Arvind Narayanan',
      category: 'Software Engineering',
      type: 'EBOOK',
      year: 2025,
      pages: 184,
      format: 'EPUB',
      summary:
        'A practical university e-book covering encapsulation, inheritance hierarchies, interface segregation, and MVC separation using modern Java.',
      chapters: [
        {
          title: '1. Encapsulation & Domain Modeling',
          body: 'Encapsulation protects object invariants by keeping state fields private and exposing domain-validating methods. In a Smart Library system, Book and BorrowTransaction validate copy counts and due dates at the model boundary rather than allowing arbitrary field mutation.',
        },
        {
          title: '2. Inheritance & Runtime Polymorphism',
          body: 'By defining an abstract User superclass with Student and Librarian subclasses, authentication controllers can delegate getMaxBorrowLimit(), getLoanDurationDays(), and getDashboardPath() polymorphically without brittle role switch statements.',
        },
        {
          title: '3. Interface Abstraction & JDBC DAOs',
          body: 'Separating BookManageable and NotificationService interfaces from SQLite/MySQL Data Access Objects enables unit testing business logic cleanly while keeping PreparedStatement persistence secure against SQL injection.',
        },
      ],
      downloads: 42,
      reads: 118,
    },
    {
      title: 'Graph Algorithms & Dynamic Programming Compendium',
      author: 'Dr. Meera Krishnan',
      category: 'Algorithms',
      type: 'LECTURE_NOTES',
      year: 2026,
      pages: 76,
      format: 'PDF',
      summary:
        'Annotated semester lecture notes covering shortest paths, topological ordering, bipartite matching, and memoized DP recurrences.',
      chapters: [
        {
          title: '1. Shortest Paths & Priority Queues',
          body: 'Dijkstra’s algorithm maintains a min-heap keyed by tentative distance d[v]. With an adjacency list representation and binary heap, time complexity is O((V + E) log V) for non-negative edge weights.',
        },
        {
          title: '2. Optimal Substructure in Dynamic Programming',
          body: 'Dynamic programming applies when subproblems overlap and optimal solutions compose cleanly. Memoization caches recursive evaluations, whereas bottom-up tabulation fills states in topological order.',
        },
      ],
      downloads: 64,
      reads: 145,
    },
    {
      title: 'Distributed Consensus & Fault-Tolerant Storage Systems',
      author: 'Dr. Siddharth Rao & Dr. Elena Vance',
      category: 'Systems Architecture',
      type: 'RESEARCH_PAPER',
      year: 2025,
      pages: 28,
      format: 'PDF',
      summary:
        'Peer-reviewed systems research paper comparing Raft leader election, log compaction, and quorum reads across geo-replicated clusters.',
      chapters: [
        {
          title: 'Abstract & Problem Statement',
          body: 'Modern university and enterprise repositories require strong consistency without sacrificing availability under partial network partitions. We benchmark Raft term transitions under asymmetric packet loss.',
        },
        {
          title: 'Experimental Findings',
          body: 'Pre-vote extensions eliminate disruptive election storms during transient WAN flaps, reducing tail read latency at the 99th percentile by 38% compared to baseline configurations.',
        },
      ],
      downloads: 29,
      reads: 87,
    },
    {
      title: 'Statistical Foundations of Modern Machine Learning',
      author: 'Journal of Applied Data Science · Vol. 14',
      category: 'Data Science',
      type: 'JOURNAL',
      year: 2026,
      pages: 52,
      format: 'PDF',
      summary:
        'Quarterly peer-reviewed journal issue examining bias-variance calibration, Bayesian priors, and feature attribution methods.',
      chapters: [
        {
          title: '1. Regularization & Generalization Bounds',
          body: 'L2 weight decay constrains hypothesis complexity by penalizing squared parameter norms, yielding closed-form ridge solutions and improved conditioning under collinear academic datasets.',
        },
        {
          title: '2. Calibrated Probabilistic Classifiers',
          body: 'Temperature scaling preserves top-1 classification accuracy while aligning predicted confidence scores with empirical accuracy across held-out validation splits.',
        },
      ],
      downloads: 33,
      reads: 94,
    },
    {
      title: 'Linear Algebra for Engineering & Spectral Methods',
      author: 'Prof. Vikramaditya Kulkarni',
      category: 'Mathematics',
      type: 'EBOOK',
      year: 2024,
      pages: 210,
      format: 'EPUB',
      summary:
        'Interactive digital textbook covering vector spaces, orthogonality, Singular Value Decomposition (SVD), and principal components.',
      chapters: [
        {
          title: '1. Four Fundamental Subspaces',
          body: 'Every m×n matrix A defines a column space, row space, nullspace, and left nullspace whose dimensions satisfy rank-nullity orthogonality.',
        },
        {
          title: '2. Singular Value Decomposition (SVD)',
          body: 'Factoring A = UΣVᵀ reveals optimal low-rank approximations for recommendation engines, latent semantic indexing, and noise reduction.',
        },
      ],
      downloads: 51,
      reads: 132,
    },
    {
      title: 'Ethics of Algorithmic Governance & Digital Archives',
      author: 'Dr. Ananya Deshmukh',
      category: 'Philosophy',
      type: 'RESEARCH_PAPER',
      year: 2025,
      pages: 22,
      format: 'PDF',
      summary:
        'Philosophical inquiry into transparency, academic freedom, and fair recommendation ranking in university digital libraries.',
      chapters: [
        {
          title: '1. Epistemic Fairness in Discovery',
          body: 'Recommendation algorithms shape scholarly attention. Transparent rationale tags—showing why a resource was suggested—preserve student agency and encourage interdisciplinary serendipity.',
        },
      ],
      downloads: 19,
      reads: 54,
    },
  ];

  for (const d of digitalSeeds) {
    insertDigital.run(
      d.title,
      d.author,
      catMap.get(d.category) ?? fallbackCat,
      d.type,
      d.year,
      d.pages,
      d.format,
      d.summary,
      JSON.stringify(d.chapters),
      d.downloads,
      d.reads
    );
  }
}

function daysFromNowIso(offsetDays: number): string {
  return new Date(Date.now() + offsetDays * 86_400_000).toISOString();
}

function todayDateStr(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}

function seedDatabase(): void {
  const insertUser = db.prepare(
    'INSERT INTO users (name, email, password_hash, role, active, created_at) VALUES (?, ?, ?, ?, 1, ?)'
  );
  const insertStudent = db.prepare(
    'INSERT INTO students (user_id, enrollment_number, department, semester, interests_json) VALUES (?, ?, ?, ?, ?)'
  );
  const insertLibrarian = db.prepare(
    'INSERT INTO librarians (user_id, employee_id, office_hours) VALUES (?, ?, ?)'
  );

  // 1 Librarian & 3 Students
  const libRes = insertUser.run(
    'Dr. Kavita Rao',
    'librarian@smartlibrary.edu',
    hashPassword('admin123'),
    'LIBRARIAN',
    daysFromNowIso(-180)
  );
  const librarianId = Number(libRes.lastInsertRowid);
  insertLibrarian.run(librarianId, 'EMP-LIB-01', '08:30 AM - 05:30 PM');

  const stu1Res = insertUser.run(
    'Arjun Mehta',
    'arjun.mehta@university.edu',
    hashPassword('student123'),
    'STUDENT',
    daysFromNowIso(-150)
  );
  const arjunId = Number(stu1Res.lastInsertRowid);
  insertStudent.run(
    arjunId,
    'CS2024-104',
    'Computer Science',
    5,
    JSON.stringify(['Algorithms', 'Software Engineering', 'Systems Architecture'])
  );

  const stu2Res = insertUser.run(
    'Priya Sharma',
    'priya.sharma@university.edu',
    hashPassword('student123'),
    'STUDENT',
    daysFromNowIso(-140)
  );
  const priyaId = Number(stu2Res.lastInsertRowid);
  insertStudent.run(
    priyaId,
    'DS2024-042',
    'Data Science',
    4,
    JSON.stringify(['Data Science', 'Mathematics', 'Algorithms'])
  );

  const stu3Res = insertUser.run(
    'Daniel Kim',
    'daniel.kim@university.edu',
    hashPassword('student123'),
    'STUDENT',
    daysFromNowIso(-120)
  );
  const danielId = Number(stu3Res.lastInsertRowid);
  insertStudent.run(
    danielId,
    'HUM2023-018',
    'Philosophy & Humanities',
    6,
    JSON.stringify(['Philosophy', 'Software Engineering'])
  );

  // Categories
  const categories = [
    ['Software Engineering', 'Software architecture, design patterns, clean code, and engineering practices.'],
    ['Algorithms', 'Data structures, graph theory, complexity analysis, and discrete algorithms.'],
    ['Data Science', 'Statistical learning, machine learning foundations, and data mining.'],
    ['Systems Architecture', 'Distributed systems, operating systems, databases, and networking.'],
    ['Mathematics', 'Linear algebra, probability theory, discrete mathematics, and calculus.'],
    ['Philosophy', 'Logic, ethics in technology, epistemology, and classical humanities.'],
  ];

  const insertCat = db.prepare('INSERT INTO categories (name, description) VALUES (?, ?)');
  const catIds: Record<string, number> = {};
  for (const [name, desc] of categories) {
    const r = insertCat.run(name, desc);
    catIds[name] = Number(r.lastInsertRowid);
  }

  const csCover = '/src/assets/images/cover_computer_science_1795356526685.jpg';
  const sysCover = '/src/assets/images/cover_systems_engineering_1795356527639.jpg';
  const humCover = '/src/assets/images/cover_humanities_editorial_1795356527177.jpg';

  const booksData = [
    {
      isbn: '978-0132350884',
      title: 'Clean Code: Agile Software Craftsmanship',
      author: 'Robert C. Martin',
      publisher: 'Prentice Hall',
      year: 2008,
      cat: 'Software Engineering',
      total: 5,
      avail: 3,
      shelf: 'CS-A101',
      desc: 'Principles, patterns, and practices for writing readable, maintainable object-oriented software.',
      cover: csCover,
    },
    {
      isbn: '978-0201633610',
      title: 'Design Patterns: Elements of Reusable Object-Oriented Software',
      author: 'Erich Gamma, Richard Helm, Ralph Johnson, John Vlissides',
      publisher: 'Addison-Wesley',
      year: 1994,
      cat: 'Software Engineering',
      total: 4,
      avail: 3,
      shelf: 'CS-A104',
      desc: 'Catalog of 23 foundational creational, structural, and behavioral object-oriented design patterns.',
      cover: csCover,
    },
    {
      isbn: '978-0262046305',
      title: 'Introduction to Algorithms (4th Edition)',
      author: 'Thomas H. Cormen, Charles E. Leiserson',
      publisher: 'MIT Press',
      year: 2022,
      cat: 'Algorithms',
      total: 6,
      avail: 4,
      shelf: 'ALG-B201',
      desc: 'Comprehensive treatment of modern algorithms, asymptotic notation, dynamic programming, and graph algorithms.',
      cover: csCover,
    },
    {
      isbn: '978-0321573513',
      title: 'Algorithms (4th Edition)',
      author: 'Robert Sedgewick, Kevin Wayne',
      publisher: 'Addison-Wesley',
      year: 2011,
      cat: 'Algorithms',
      total: 4,
      avail: 4,
      shelf: 'ALG-B204',
      desc: 'Essential algorithms and data structures implemented in clean Java with rigorous empirical analysis.',
      cover: csCover,
    },
    {
      isbn: '978-1449373320',
      title: 'Designing Data-Intensive Applications',
      author: 'Martin Kleppmann',
      publisher: "O'Reilly Media",
      year: 2017,
      cat: 'Systems Architecture',
      total: 2,
      avail: 0,
      shelf: 'SYS-C102',
      desc: 'Big ideas behind reliable, scalable, and maintainable distributed data systems and storage engines.',
      cover: sysCover,
    },
    {
      isbn: '978-0131103627',
      title: 'The C Programming Language',
      author: 'Brian W. Kernighan, Dennis M. Ritchie',
      publisher: 'Prentice Hall',
      year: 1988,
      cat: 'Systems Architecture',
      total: 4,
      avail: 3,
      shelf: 'SYS-C108',
      desc: 'Authoritative guide to systems programming, memory models, and low-level architecture.',
      cover: sysCover,
    },
    {
      isbn: '978-0134685991',
      title: 'Effective Java (3rd Edition)',
      author: 'Joshua Bloch',
      publisher: 'Addison-Wesley',
      year: 2018,
      cat: 'Software Engineering',
      total: 5,
      avail: 5,
      shelf: 'CS-A112',
      desc: 'Best practices for object-oriented design, generics, concurrency, and Java platform mastery.',
      cover: csCover,
    },
    {
      isbn: '978-0387310732',
      title: 'Pattern Recognition and Machine Learning',
      author: 'Christopher M. Bishop',
      publisher: 'Springer',
      year: 2006,
      cat: 'Data Science',
      total: 4,
      avail: 3,
      shelf: 'DS-D301',
      desc: 'Foundational text covering Bayesian inference, graphical models, and statistical learning theory.',
      cover: sysCover,
    },
    {
      isbn: '978-1098103828',
      title: 'Designing Machine Learning Systems',
      author: 'Chip Huyen',
      publisher: "O'Reilly Media",
      year: 2022,
      cat: 'Data Science',
      total: 3,
      avail: 3,
      shelf: 'DS-D305',
      desc: 'Iterative process for building reliable, scalable production machine learning pipelines.',
      cover: sysCover,
    },
    {
      isbn: '978-0980232776',
      title: 'Introduction to Linear Algebra (5th Edition)',
      author: 'Gilbert Strang',
      publisher: 'Wellesley-Cambridge Press',
      year: 2016,
      cat: 'Mathematics',
      total: 5,
      avail: 4,
      shelf: 'MTH-E101',
      desc: 'Vector spaces, eigenvalues, singular value decomposition, and applications across engineering.',
      cover: csCover,
    },
    {
      isbn: '978-0140449136',
      title: 'Meditations: Annotated Academic Edition',
      author: 'Marcus Aurelius',
      publisher: 'Penguin Classics',
      year: 2006,
      cat: 'Philosophy',
      total: 4,
      avail: 3,
      shelf: 'HUM-F201',
      desc: 'Stoic philosophical reflections on discipline, civic duty, and reasoned inquiry.',
      cover: humCover,
    },
    {
      isbn: '978-0199535705',
      title: 'An Enquiry Concerning Human Understanding',
      author: 'David Hume',
      publisher: 'Oxford University Press',
      year: 2007,
      cat: 'Philosophy',
      total: 3,
      avail: 3,
      shelf: 'HUM-F206',
      desc: 'Classic epistemological treatise examining empiricism, causation, and rational skepticism.',
      cover: humCover,
    },
  ];

  const insertBook = db.prepare(`
    INSERT INTO books (
      isbn, title, author, publisher, publication_year, category_id,
      total_copies, available_copies, shelf_location, description, cover_url
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const bookIds: number[] = [];
  for (const b of booksData) {
    const res = insertBook.run(
      b.isbn,
      b.title,
      b.author,
      b.publisher,
      b.year,
      catIds[b.cat],
      b.total,
      b.avail,
      b.shelf,
      b.desc,
      b.cover
    );
    bookIds.push(Number(res.lastInsertRowid));
  }

  // Seed Borrow Transactions (mix of returned history across recent months, active due-soon, overdue, and pending)
  const insertTx = db.prepare(`
    INSERT INTO borrow_transactions (
      book_id, student_user_id, status, requested_at, issued_at, due_date, returned_at, approved_by_user_id
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);

  // Historical returned transactions across past 5 months for Analytics chart
  const historicalSeeds = [
    { bookIdx: 0, studentId: arjunId, reqOff: -145, retOff: -133 },
    { bookIdx: 2, studentId: priyaId, reqOff: -140, retOff: -127 },
    { bookIdx: 9, studentId: priyaId, reqOff: -118, retOff: -105 },
    { bookIdx: 6, studentId: arjunId, reqOff: -110, retOff: -98 },
    { bookIdx: 10, studentId: danielId, reqOff: -95, retOff: -83 },
    { bookIdx: 1, studentId: arjunId, reqOff: -88, retOff: -75 },
    { bookIdx: 7, studentId: priyaId, reqOff: -72, retOff: -60 },
    { bookIdx: 4, studentId: arjunId, reqOff: -65, retOff: -52 },
    { bookIdx: 3, studentId: priyaId, reqOff: -48, retOff: -35 },
    { bookIdx: 5, studentId: danielId, reqOff: -42, retOff: -31 },
    { bookIdx: 8, studentId: priyaId, reqOff: -28, retOff: -16 },
    { bookIdx: 11, studentId: danielId, reqOff: -22, retOff: -11 },
  ];

  for (const h of historicalSeeds) {
    const req = daysFromNowIso(h.reqOff);
    const due = daysFromNowIso(h.reqOff + 14);
    const ret = daysFromNowIso(h.retOff);
    insertTx.run(bookIds[h.bookIdx], h.studentId, 'RETURNED', req, req, due, ret, librarianId);
  }

  // Active borrows matching reduced available_copies:
  // Book 0 (Clean Code): 2 borrowed (avail 3/5) -> 1 due in 2 days for Arjun (triggers DUE_SOON alert), 1 for Priya
  insertTx.run(
    bookIds[0],
    arjunId,
    'BORROWED',
    daysFromNowIso(-12),
    daysFromNowIso(-12),
    daysFromNowIso(2),
    null,
    librarianId
  );
  insertTx.run(
    bookIds[0],
    priyaId,
    'BORROWED',
    daysFromNowIso(-5),
    daysFromNowIso(-5),
    daysFromNowIso(9),
    null,
    librarianId
  );

  // Book 4 (DDIA): 2 borrowed (avail 0/2) -> 1 OVERDUE by 4 days for Arjun, 1 active for Priya
  insertTx.run(
    bookIds[4],
    arjunId,
    'OVERDUE',
    daysFromNowIso(-18),
    daysFromNowIso(-18),
    daysFromNowIso(-4),
    null,
    librarianId
  );
  insertTx.run(
    bookIds[4],
    priyaId,
    'BORROWED',
    daysFromNowIso(-6),
    daysFromNowIso(-6),
    daysFromNowIso(8),
    null,
    librarianId
  );

  // Book 1 (Design Patterns): 1 pending request from Daniel Kim
  insertTx.run(
    bookIds[1],
    danielId,
    'PENDING',
    daysFromNowIso(-1),
    null,
    null,
    null,
    null
  );

  // Book 2 (CLRS): 2 borrowed (avail 4/6) -> 1 active for Daniel, 1 active for Priya
  insertTx.run(
    bookIds[2],
    danielId,
    'BORROWED',
    daysFromNowIso(-7),
    daysFromNowIso(-7),
    daysFromNowIso(7),
    null,
    librarianId
  );
  insertTx.run(
    bookIds[2],
    priyaId,
    'BORROWED',
    daysFromNowIso(-3),
    daysFromNowIso(-3),
    daysFromNowIso(11),
    null,
    librarianId
  );

  // Book 5 (C Programming): 1 borrowed (avail 3/4) for Arjun
  insertTx.run(
    bookIds[5],
    arjunId,
    'BORROWED',
    daysFromNowIso(-4),
    daysFromNowIso(-4),
    daysFromNowIso(10),
    null,
    librarianId
  );

  // Book 7 (PRML): 1 borrowed (avail 3/4) for Priya
  insertTx.run(
    bookIds[7],
    priyaId,
    'BORROWED',
    daysFromNowIso(-9),
    daysFromNowIso(-9),
    daysFromNowIso(5),
    null,
    librarianId
  );

  // Book 9 (Linear Algebra): 1 borrowed (avail 4/5) for Daniel
  insertTx.run(
    bookIds[9],
    danielId,
    'BORROWED',
    daysFromNowIso(-10),
    daysFromNowIso(-10),
    daysFromNowIso(4),
    null,
    librarianId
  );

  // Book 10 (Meditations): 1 borrowed (avail 3/4) for Daniel
  insertTx.run(
    bookIds[10],
    danielId,
    'BORROWED',
    daysFromNowIso(-2),
    daysFromNowIso(-2),
    daysFromNowIso(12),
    null,
    librarianId
  );

  // Seats (16 seats across 2 floors)
  const insertSeat = db.prepare(
    'INSERT INTO library_seats (seat_code, floor, zone, has_power_outlet, is_quiet_zone) VALUES (?, ?, ?, ?, ?)'
  );
  const seatIds: number[] = [];
  for (let i = 1; i <= 8; i++) {
    const code = `A-0${i}`;
    const r = insertSeat.run(code, 'Floor 1', 'Quiet Reading Wing', 1, 1);
    seatIds.push(Number(r.lastInsertRowid));
  }
  for (let i = 1; i <= 8; i++) {
    const code = `B-0${i}`;
    const r = insertSeat.run(code, 'Floor 2', 'Collaborative Commons', i % 2 === 1 ? 1 : 0, 0);
    seatIds.push(Number(r.lastInsertRowid));
  }

  // Initial seat bookings for today
  const today = todayDateStr();
  const insertSeatBooking = db.prepare(
    'INSERT INTO seat_bookings (seat_id, student_user_id, booking_date, time_slot, status, created_at) VALUES (?, ?, ?, ?, ?, ?)'
  );
  insertSeatBooking.run(seatIds[0], priyaId, today, '10:00 - 12:00', 'ACTIVE', new Date().toISOString());
  insertSeatBooking.run(seatIds[1], danielId, today, '10:00 - 12:00', 'ACTIVE', new Date().toISOString());
  insertSeatBooking.run(seatIds[8], arjunId, today, '14:00 - 16:00', 'ACTIVE', new Date().toISOString());

  // Sync automated fines and notifications right away
  syncOverdueAndAlerts();
}

export function syncOverdueAndAlerts(): void {
  const nowIso = new Date().toISOString();
  const activeLoans = db
    .prepare(
      `SELECT bt.id, bt.book_id, bt.student_user_id, bt.status, bt.due_date, b.title
       FROM borrow_transactions bt
       JOIN books b ON b.id = bt.book_id
       WHERE bt.status IN ('BORROWED', 'OVERDUE') AND bt.due_date IS NOT NULL`
    )
    .all() as Array<{
    id: number;
    book_id: number;
    student_user_id: number;
    status: string;
    due_date: string;
    title: string;
  }>;

  const markOverdue = db.prepare("UPDATE borrow_transactions SET status = 'OVERDUE' WHERE id = ?");
  const upsertFine = db.prepare(`
    INSERT INTO fines (transaction_id, student_user_id, amount, days_overdue, status, assessed_at)
    VALUES (?, ?, ?, ?, 'UNPAID', ?)
    ON CONFLICT(transaction_id) DO UPDATE SET
      amount = CASE WHEN fines.status = 'UNPAID' THEN excluded.amount ELSE fines.amount END,
      days_overdue = CASE WHEN fines.status = 'UNPAID' THEN excluded.days_overdue ELSE fines.days_overdue END
  `);

  const existingNotifCheck = db.prepare(
    'SELECT id FROM notifications WHERE user_id = ? AND type = ? AND title = ?'
  );
  const insertNotif = db.prepare(
    'INSERT INTO notifications (user_id, title, message, type, is_read, created_at) VALUES (?, ?, ?, ?, 0, ?)'
  );

  for (const loan of activeLoans) {
    const overdueDays = FineCalculator.calculateOverdueDays(loan.due_date, nowIso);
    if (overdueDays > 0) {
      if (loan.status !== 'OVERDUE') {
        markOverdue.run(loan.id);
      }
      const fineAmount = FineCalculator.calculateFineAmount(overdueDays);
      upsertFine.run(loan.id, loan.student_user_id, fineAmount, overdueDays, nowIso);

      const notifTitle = `Overdue Notice: ${loan.title}`;
      const existing = existingNotifCheck.get(loan.student_user_id, 'OVERDUE', notifTitle);
      if (!existing) {
        insertNotif.run(
          loan.student_user_id,
          notifTitle,
          `This book is ${overdueDays} day(s) overdue. Current accrued fine: ₹${fineAmount.toFixed(2)}.`,
          'OVERDUE',
          nowIso
        );
      }
    } else if (FineCalculator.isDueSoon(loan.due_date, nowIso)) {
      const daysLeft = FineCalculator.getDaysRemaining(loan.due_date, nowIso);
      const notifTitle = `Due Soon: ${loan.title}`;
      const existing = existingNotifCheck.get(loan.student_user_id, 'DUE_SOON', notifTitle);
      if (!existing) {
        insertNotif.run(
          loan.student_user_id,
          notifTitle,
          `Please return "${loan.title}" within ${daysLeft} day(s) to avoid overdue fines (₹10.00/day).`,
          'DUE_SOON',
          nowIso
        );
      }
    }
  }
}

export function buildBookQrPayload(bookId: number, isbn: string): string {
  return QRCodePayloadService.buildBookPayload(bookId, isbn);
}
