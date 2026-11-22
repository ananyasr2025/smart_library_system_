import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Armchair,
  BarChart3,
  BookMarked,
  BookOpen,
  Check,
  Edit3,
  FileText,
  LogOut,
  Menu,
  Plus,
  QrCode,
  RefreshCw,
  Search,
  Trash2,
  Users,
  X,
} from 'lucide-react';
import type {
  AnalyticsReport,
  Book,
  BorrowTransaction,
  Category,
  FineRecord,
  UserProfile,
} from '../domain/types';
import { api } from '../services/api';
import { BookDetailModal } from './BookDetailModal';
import { DigitalLibraryView } from './DigitalLibraryView';
import { SeatReservationView } from './SeatReservationView';

type LibrarianTab = 'ANALYTICS' | 'BOOKS' | 'DIGITAL' | 'CIRCULATION' | 'STUDENTS' | 'SEATS';

interface LibrarianPortalProps {
  user: UserProfile;
  onLogout: () => void;
}

export function LibrarianPortal({ user, onLogout }: LibrarianPortalProps) {
  const [activeTab, setActiveTab] = useState<LibrarianTab>('ANALYTICS');
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  const [report, setReport] = useState<AnalyticsReport | null>(null);
  const [books, setBooks] = useState<Book[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [transactions, setTransactions] = useState<BorrowTransaction[]>([]);
  const [fines, setFines] = useState<FineRecord[]>([]);
  const [students, setStudents] = useState<
    Array<{
      id: number;
      name: string;
      email: string;
      active: boolean;
      createdAt: string;
      enrollmentNumber: string;
      department: string;
      semester: number;
      interests: string[];
      activeBorrows: number;
      unpaidFines: number;
    }>
  >([]);

  const [bookSearch, setBookSearch] = useState('');
  const [circulationFilter, setCirculationFilter] = useState<'PENDING' | 'ACTIVE' | 'ALL' | 'FINES'>('PENDING');
  const [selectedBookForQr, setSelectedBookForQr] = useState<Book | null>(null);

  // Add / Edit Book Modal State
  const [bookFormOpen, setBookFormOpen] = useState(false);
  const [editingBook, setEditingBook] = useState<Book | null>(null);
  const [fIsbn, setFIsbn] = useState('');
  const [fTitle, setFTitle] = useState('');
  const [fAuthor, setFAuthor] = useState('');
  const [fPublisher, setFPublisher] = useState('Academic Press');
  const [fYear, setFYear] = useState(2025);
  const [fCategoryId, setFCategoryId] = useState<number>(1);
  const [fCopies, setFCopies] = useState(3);
  const [fShelf, setFShelf] = useState('CS-A105');
  const [fDesc, setFDesc] = useState('');
  const [formSaving, setFormSaving] = useState(false);

  const [loading, setLoading] = useState(true);
  const [toast, setToast] = useState<{ type: 'success' | 'error'; message: string } | null>(null);

  const showToast = useCallback((type: 'success' | 'error', message: string) => {
    setToast({ type, message });
    setTimeout(() => {
      setToast((prev) => (prev?.message === message ? null : prev));
    }, 5000);
  }, []);

  const loadAllData = useCallback(async () => {
    try {
      const [repRes, bookRes, catRes, txRes, fineRes, stuRes] = await Promise.all([
        api.getAnalytics(),
        api.getBooks(),
        api.getCategories(),
        api.getTransactions(),
        api.getFines(),
        api.getStudents(),
      ]);
      setReport(repRes.report);
      setBooks(bookRes.books);
      setCategories(catRes.categories);
      setTransactions(txRes.transactions);
      setFines(fineRes.fines);
      setStudents(stuRes.students);
      if (catRes.categories.length > 0 && !editingBook) {
        setFCategoryId((prev) => prev || catRes.categories[0].id);
      }
    } catch (err) {
      showToast('error', err instanceof Error ? err.message : 'Unable to load librarian data.');
    } finally {
      setLoading(false);
    }
  }, [editingBook]);

  useEffect(() => {
    loadAllData();
  }, [loadAllData]);

  const openAddBook = () => {
    setEditingBook(null);
    setFIsbn('');
    setFTitle('');
    setFAuthor('');
    setFPublisher('Academic Press');
    setFYear(2025);
    setFCategoryId(categories[0]?.id ?? 1);
    setFCopies(3);
    setFShelf('CS-A120');
    setFDesc('');
    setBookFormOpen(true);
  };

  const openEditBook = (book: Book) => {
    setEditingBook(book);
    setFIsbn(book.isbn);
    setFTitle(book.title);
    setFAuthor(book.author);
    setFPublisher(book.publisher);
    setFYear(book.publicationYear);
    setFCategoryId(book.categoryId);
    setFCopies(book.totalCopies);
    setFShelf(book.shelfLocation);
    setFDesc(book.description);
    setBookFormOpen(true);
  };

  const handleSaveBook = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!fIsbn.trim() || !fTitle.trim() || !fAuthor.trim() || !fShelf.trim()) {
      showToast('error', 'ISBN, title, author, and shelf location are required.');
      return;
    }

    setFormSaving(true);
    try {
      const payload = {
        isbn: fIsbn.trim(),
        title: fTitle.trim(),
        author: fAuthor.trim(),
        publisher: fPublisher.trim() || 'Academic Press',
        publicationYear: Number(fYear) || 2025,
        categoryId: Number(fCategoryId),
        totalCopies: Math.max(1, Number(fCopies) || 1),
        shelfLocation: fShelf.trim(),
        description: fDesc.trim(),
      };
      if (editingBook) {
        await api.updateBook(editingBook.id, payload);
        showToast('success', `Updated "${payload.title}".`);
      } else {
        await api.createBook(payload);
        showToast('success', `Added "${payload.title}" to catalog with QR code.`);
      }
      setBookFormOpen(false);
      await loadAllData();
    } catch (err) {
      showToast('error', err instanceof Error ? err.message : 'Unable to save book.');
    } finally {
      setFormSaving(false);
    }
  };

  const handleDeleteBook = async (book: Book) => {
    try {
      await api.deleteBook(book.id);
      showToast('success', `Deleted "${book.title}" from catalog.`);
      await loadAllData();
    } catch (err) {
      showToast('error', err instanceof Error ? err.message : 'Unable to delete book.');
    }
  };

  const handleApprove = async (txId: number) => {
    try {
      await api.approveTransaction(txId);
      showToast('success', 'Borrowing request approved and book issued.');
      await loadAllData();
    } catch (err) {
      showToast('error', err instanceof Error ? err.message : 'Unable to approve request.');
    }
  };

  const handleReject = async (txId: number) => {
    try {
      await api.rejectTransaction(txId);
      showToast('success', 'Borrowing request declined.');
      await loadAllData();
    } catch (err) {
      showToast('error', err instanceof Error ? err.message : 'Unable to reject request.');
    }
  };

  const handleDeskReturn = async (txId: number) => {
    try {
      const res = await api.returnBook(txId);
      showToast(
        'success',
        res.fineAssessed > 0
          ? `Book returned. Assessed overdue fine: ₹${res.fineAssessed.toFixed(2)}.`
          : 'Book return recorded.'
      );
      await loadAllData();
    } catch (err) {
      showToast('error', err instanceof Error ? err.message : 'Unable to process return.');
    }
  };

  const handleMarkFinePaid = async (fineId: number) => {
    try {
      await api.payFine(fineId);
      showToast('success', 'Fine marked as PAID.');
      await loadAllData();
    } catch (err) {
      showToast('error', err instanceof Error ? err.message : 'Unable to update fine.');
    }
  };

  const handleToggleStudent = async (studentId: number, currentActive: boolean) => {
    try {
      await api.toggleStudentStatus(studentId, !currentActive);
      showToast('success', `Student account ${currentActive ? 'deactivated' : 'activated'}.`);
      await loadAllData();
    } catch (err) {
      showToast('error', err instanceof Error ? err.message : 'Unable to update student status.');
    }
  };

  const filteredBooks = useMemo(() => {
    const q = bookSearch.trim().toLowerCase();
    if (!q) return books;
    return books.filter(
      (b) =>
        b.title.toLowerCase().includes(q) ||
        b.author.toLowerCase().includes(q) ||
        b.isbn.toLowerCase().includes(q) ||
        b.categoryName.toLowerCase().includes(q)
    );
  }, [books, bookSearch]);

  const pendingTransactions = transactions.filter((t) => t.status === 'PENDING');
  const activeTransactions = transactions.filter(
    (t) => t.status === 'BORROWED' || t.status === 'OVERDUE'
  );

  const navItems: Array<{ id: LibrarianTab; label: string; icon: typeof BarChart3 }> = [
    { id: 'ANALYTICS', label: 'Analytics & Reports', icon: BarChart3 },
    { id: 'BOOKS', label: 'Manage Books', icon: BookOpen },
    { id: 'DIGITAL', label: 'Digital Repository', icon: FileText },
    { id: 'CIRCULATION', label: 'Circulation & Fines', icon: RefreshCw },
    { id: 'STUDENTS', label: 'Student Accounts', icon: Users },
    { id: 'SEATS', label: 'Seat Monitoring', icon: Armchair },
  ];

  const activeNavTitle = navItems.find((i) => i.id === activeTab)?.label ?? 'Analytics';

  const maxMonthlyVal = useMemo(() => {
    if (!report) return 5;
    const m = Math.max(
      ...report.monthlyBorrowing.map((x) => Math.max(x.borrows, x.returns)),
      4
    );
    return m;
  }, [report]);

  return (
    <div className="min-h-screen bg-slate-50 flex">
      {mobileMenuOpen && (
        <div
          className="fixed inset-0 z-40 bg-slate-950/50 lg:hidden"
          onClick={() => setMobileMenuOpen(false)}
          aria-hidden="true"
        />
      )}

      {/* Dark Navy Sidebar */}
      <aside
        className={`${
          mobileMenuOpen ? 'fixed inset-y-0 left-0 z-50 flex' : 'hidden lg:flex'
        } w-64 bg-[#0F1E36] text-white flex-col shrink-0`}
      >
        <div className="flex items-center justify-between px-6 py-5 border-b border-white/10">
          <div className="flex items-center gap-2.5 min-w-0">
            <BookMarked className="w-6 h-6 text-blue-300 shrink-0" />
            <span className="font-display text-base font-bold tracking-tight truncate">
              Smart Library
            </span>
          </div>
          <button
            type="button"
            onClick={() => setMobileMenuOpen(false)}
            aria-label="Close navigation menu"
            className="lg:hidden rounded p-1 text-slate-300 hover:text-white"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <nav className="flex-1 px-3 py-5 space-y-1" aria-label="Librarian Portal Navigation">
          {navItems.map((item) => {
            const Icon = item.icon;
            const active = activeTab === item.id;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => {
                  setActiveTab(item.id);
                  setMobileMenuOpen(false);
                }}
                className={`flex w-full items-center justify-between rounded-lg px-3.5 py-2.5 text-sm font-medium whitespace-nowrap ${
                  active
                    ? 'bg-[#2563EB] text-white'
                    : 'text-slate-300 hover:bg-white/10 hover:text-white'
                }`}
              >
                <span className="flex items-center gap-3">
                  <Icon className="w-4 h-4 shrink-0" />
                  <span>{item.label}</span>
                </span>
                {item.id === 'CIRCULATION' && pendingTransactions.length > 0 && (
                  <span className="rounded-full bg-blue-500/30 px-2 py-0.5 text-[11px] font-mono tabular-nums text-blue-100">
                    {pendingTransactions.length}
                  </span>
                )}
              </button>
            );
          })}
        </nav>

        <div className="border-t border-white/10 p-4 space-y-3">
          <div className="px-2">
            <p className="text-sm font-semibold text-white truncate">{user.name}</p>
            <p className="text-xs font-mono text-blue-200 truncate">
              {user.employeeId || 'LIBRARIAN'} · Admin Desk
            </p>
          </div>
          <button
            type="button"
            onClick={onLogout}
            className="flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-sm font-medium text-slate-300 hover:bg-white/10 hover:text-white transition-colors"
          >
            <LogOut className="w-4 h-4" />
            <span>Sign Out</span>
          </button>
        </div>
      </aside>

      {/* Main Content */}
      <div className="flex-1 flex flex-col min-w-0">
        <header className="sticky top-0 z-30 flex items-center justify-between gap-4 border-b border-slate-200 bg-white px-6 py-3.5">
          <div className="flex items-center gap-3 min-w-0">
            <button
              type="button"
              onClick={() => setMobileMenuOpen(true)}
              aria-label="Open navigation menu"
              className="lg:hidden rounded-lg border border-slate-200 p-2 text-slate-600 hover:bg-slate-50"
            >
              <Menu className="w-5 h-5" />
            </button>
            <div className="flex items-center gap-2 text-sm min-w-0">
              <span className="text-slate-500 hidden sm:inline">Librarian Admin</span>
              <span className="text-slate-300 hidden sm:inline">/</span>
              <h1 className="font-display font-bold text-[#0F1E36] truncate">{activeNavTitle}</h1>
            </div>
          </div>

          <button
            type="button"
            onClick={openAddBook}
            className="inline-flex items-center gap-2 rounded-lg bg-[#2563EB] px-3.5 py-2 text-xs font-semibold text-white hover:bg-blue-700 transition-colors whitespace-nowrap shrink-0"
          >
            <Plus className="w-4 h-4" />
            Add Book
          </button>
        </header>

        {toast && (
          <div className="px-6 pt-4">
            <div
              role={toast.type === 'error' ? 'alert' : 'status'}
              className={`flex items-center justify-between rounded-lg border px-4 py-3 text-sm ${
                toast.type === 'error'
                  ? 'border-red-200 bg-red-50 text-red-800'
                  : 'border-emerald-200 bg-emerald-50 text-emerald-800'
              }`}
            >
              <span>{toast.message}</span>
              <button
                type="button"
                onClick={() => setToast(null)}
                aria-label="Dismiss message"
                className="ml-4 text-current opacity-70 hover:opacity-100"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          </div>
        )}

        <main className="flex-1 p-6 max-w-7xl w-full mx-auto space-y-6">
          {loading ? (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
              {[1, 2, 3, 4].map((n) => (
                <div key={n} className="h-28 animate-pulse rounded-xl border border-slate-200 bg-white" />
              ))}
            </div>
          ) : (
            <>
              {/* FEATURE 5: LIBRARY INTELLIGENCE & ANALYTICS */}
              {activeTab === 'ANALYTICS' && report && (
                <div className="space-y-6">
                  {/* 4-Column KPI Strip */}
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                    <div className="rounded-xl border border-slate-200 bg-white p-5">
                      <p className="text-xs font-medium text-slate-500">Catalog Inventory</p>
                      <p className="mt-2 font-display text-2xl font-bold text-[#0F1E36] tabular-nums">
                        {report.totals.totalBooks} Titles
                      </p>
                      <p className="mt-1 text-xs text-slate-600 tabular-nums">
                        {report.totals.availableCopies} of {report.totals.totalCopies} copies available
                      </p>
                    </div>
                    <div className="rounded-xl border border-slate-200 bg-white p-5">
                      <p className="text-xs font-medium text-slate-500">Issued Copies</p>
                      <p className="mt-2 font-display text-2xl font-bold text-[#2563EB] tabular-nums">
                        {report.totals.issuedCopies}
                      </p>
                      <p className="mt-1 text-xs text-slate-600 tabular-nums">
                        {report.totals.pendingRequests} pending desk request(s)
                      </p>
                    </div>
                    <div className="rounded-xl border border-slate-200 bg-white p-5">
                      <p className="text-xs font-medium text-slate-500">Overdue & Unpaid Fines</p>
                      <p className="mt-2 font-display text-2xl font-bold text-red-700 tabular-nums">
                        {report.totals.overdueCount} Overdue
                      </p>
                      <p className="mt-1 text-xs text-slate-600 tabular-nums">
                        ₹{report.totals.unpaidFinesTotal.toFixed(2)} outstanding fines
                      </p>
                    </div>
                    <div className="rounded-xl border border-slate-200 bg-white p-5">
                      <p className="text-xs font-medium text-slate-500">Digital & Campus Usage</p>
                      <p className="mt-2 font-display text-2xl font-bold text-[#0F1E36] tabular-nums">
                        {report.totals.totalDigitalResources} Digital Items
                      </p>
                      <p className="mt-1 text-xs text-slate-600 tabular-nums">
                        {report.totals.totalDigitalReads} online reads · {report.totals.activeSeatBookings} seat bookings
                      </p>
                    </div>
                  </div>

                  {/* Monthly Borrowing Chart & Category Breakdown */}
                  <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
                    <section className="lg:col-span-8 rounded-xl border border-slate-200 bg-white p-6 space-y-4">
                      <div className="flex flex-wrap items-center justify-between gap-3">
                        <div>
                          <h2 className="font-display text-base font-bold text-[#0F1E36]">
                            Monthly Borrowing & Return Report
                          </h2>
                          <p className="text-xs text-slate-500">
                            6-month circulation volume derived from live relational transactions
                          </p>
                        </div>
                        <div className="flex items-center gap-4 text-xs text-slate-600">
                          <span className="inline-flex items-center gap-1.5">
                            <span className="h-2.5 w-2.5 rounded-xs bg-[#0F1E36]" />
                            Borrows
                          </span>
                          <span className="inline-flex items-center gap-1.5">
                            <span className="h-2.5 w-2.5 rounded-xs bg-[#2563EB]" />
                            Returns
                          </span>
                        </div>
                      </div>

                      {/* Clean SVG Dual-Bar Chart */}
                      <div className="pt-2">
                        <svg
                          viewBox="0 0 600 220"
                          className="w-full h-56 overflow-visible"
                          role="img"
                          aria-label="Monthly borrowing and return bar chart"
                        >
                          {[0, 0.25, 0.5, 0.75, 1].map((tick) => {
                            const y = 180 - tick * 150;
                            const val = Math.round(tick * maxMonthlyVal);
                            return (
                              <g key={tick}>
                                <line
                                  x1="36"
                                  y1={y}
                                  x2="588"
                                  y2={y}
                                  stroke="#E2E8F0"
                                  strokeWidth="1"
                                />
                                <text
                                  x="28"
                                  y={y + 4}
                                  textAnchor="end"
                                  className="fill-slate-400 text-[10px] font-mono"
                                >
                                  {val}
                                </text>
                              </g>
                            );
                          })}

                          {report.monthlyBorrowing.map((m, idx) => {
                            const groupWidth = 540 / report.monthlyBorrowing.length;
                            const centerX = 48 + idx * groupWidth + groupWidth / 2;
                            const barW = 20;
                            const hBorrow = (m.borrows / maxMonthlyVal) * 150;
                            const hReturn = (m.returns / maxMonthlyVal) * 150;
                            return (
                              <g key={m.month}>
                                <rect
                                  x={centerX - barW - 2}
                                  y={180 - hBorrow}
                                  width={barW}
                                  height={Math.max(2, hBorrow)}
                                  rx="3"
                                  fill="#0F1E36"
                                />
                                <text
                                  x={centerX - barW / 2 - 2}
                                  y={174 - hBorrow}
                                  textAnchor="middle"
                                  className="fill-[#0F1E36] text-[10px] font-mono font-semibold"
                                >
                                  {m.borrows}
                                </text>
                                <rect
                                  x={centerX + 2}
                                  y={180 - hReturn}
                                  width={barW}
                                  height={Math.max(2, hReturn)}
                                  rx="3"
                                  fill="#2563EB"
                                />
                                <text
                                  x={centerX + barW / 2 + 2}
                                  y={174 - hReturn}
                                  textAnchor="middle"
                                  className="fill-[#2563EB] text-[10px] font-mono font-semibold"
                                >
                                  {m.returns}
                                </text>
                                <text
                                  x={centerX}
                                  y="202"
                                  textAnchor="middle"
                                  className="fill-slate-600 text-[11px] font-medium"
                                >
                                  {m.label}
                                </text>
                              </g>
                            );
                          })}
                        </svg>
                      </div>
                    </section>

                    <section className="lg:col-span-4 rounded-xl border border-slate-200 bg-white p-6 space-y-4">
                      <h2 className="font-display text-base font-bold text-[#0F1E36]">
                        Circulation by Category
                      </h2>
                      <div className="space-y-3.5">
                        {report.categoryBreakdown.map((cat) => {
                          const maxCat = Math.max(
                            ...report.categoryBreakdown.map((c) => c.borrowCount),
                            1
                          );
                          const pct = Math.round((cat.borrowCount / maxCat) * 100);
                          return (
                            <div key={cat.categoryName} className="space-y-1">
                              <div className="flex items-center justify-between text-xs">
                                <span className="font-medium text-slate-800">{cat.categoryName}</span>
                                <span className="font-mono text-slate-500 tabular-nums">
                                  {cat.borrowCount} loans · {cat.bookCount} titles
                                </span>
                              </div>
                              <div className="h-2 w-full rounded-full bg-slate-100 overflow-hidden">
                                <div
                                  className="h-full rounded-full bg-[#2563EB]"
                                  style={{ width: `${Math.max(6, pct)}%` }}
                                />
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </section>
                  </div>

                  {/* Most Borrowed Books & Most Active Students */}
                  <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                    <section className="rounded-xl border border-slate-200 bg-white overflow-hidden">
                      <div className="border-b border-slate-200 px-5 py-4">
                        <h3 className="font-display text-base font-bold text-[#0F1E36]">
                          Most Borrowed Books
                        </h3>
                      </div>
                      <table className="w-full text-left text-sm">
                        <thead className="bg-slate-50 text-xs font-semibold text-slate-600 border-b border-slate-200">
                          <tr>
                            <th className="px-5 py-2.5">Title & Author</th>
                            <th className="px-5 py-2.5">Category</th>
                            <th className="px-5 py-2.5 text-right">Borrows</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100">
                          {report.mostBorrowedBooks.map((b) => (
                            <tr key={b.bookId}>
                              <td className="px-5 py-3">
                                <p className="font-semibold text-[#0F1E36]">{b.title}</p>
                                <p className="text-xs text-slate-500">{b.author}</p>
                              </td>
                              <td className="px-5 py-3 text-xs text-slate-600">{b.categoryName}</td>
                              <td className="px-5 py-3 text-right font-mono font-bold text-[#0F1E36] tabular-nums">
                                {b.borrowCount}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </section>

                    <section className="rounded-xl border border-slate-200 bg-white overflow-hidden">
                      <div className="border-b border-slate-200 px-5 py-4">
                        <h3 className="font-display text-base font-bold text-[#0F1E36]">
                          Most Active Students
                        </h3>
                      </div>
                      <table className="w-full text-left text-sm">
                        <thead className="bg-slate-50 text-xs font-semibold text-slate-600 border-b border-slate-200">
                          <tr>
                            <th className="px-5 py-2.5">Student</th>
                            <th className="px-5 py-2.5">Department</th>
                            <th className="px-5 py-2.5 text-right">Total Loans</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100">
                          {report.mostActiveStudents.map((s) => (
                            <tr key={s.userId}>
                              <td className="px-5 py-3">
                                <p className="font-semibold text-[#0F1E36]">{s.name}</p>
                                <p className="text-xs font-mono text-slate-500">{s.enrollmentNumber}</p>
                              </td>
                              <td className="px-5 py-3 text-xs text-slate-600">{s.department}</td>
                              <td className="px-5 py-3 text-right font-mono font-bold text-[#2563EB] tabular-nums">
                                {s.borrowCount}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </section>
                  </div>
                </div>
              )}

              {/* MANAGE BOOKS CRUD */}
              {activeTab === 'BOOKS' && (
                <div className="space-y-4">
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                    <div className="relative flex-1 max-w-md">
                      <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
                      <label htmlFor="admin-book-search" className="sr-only">
                        Search inventory
                      </label>
                      <input
                        id="admin-book-search"
                        type="search"
                        value={bookSearch}
                        onChange={(e) => setBookSearch(e.target.value)}
                        placeholder="Filter inventory by title, author, ISBN..."
                        className="w-full rounded-lg border border-slate-300 bg-white pl-10 pr-4 py-2 text-sm focus:border-[#2563EB] focus:outline-none"
                      />
                    </div>
                    <p className="text-xs font-medium text-slate-500 tabular-nums">
                      Showing {filteredBooks.length} of {books.length} catalog titles
                    </p>
                  </div>

                  <div className="rounded-xl border border-slate-200 bg-white overflow-hidden">
                    <div className="overflow-x-auto">
                      <table className="w-full text-left text-sm">
                        <thead className="bg-slate-50 text-xs font-semibold text-slate-600 border-b border-slate-200">
                          <tr>
                            <th className="px-5 py-3">Book & Author</th>
                            <th className="px-5 py-3">ISBN</th>
                            <th className="px-5 py-3">Category</th>
                            <th className="px-5 py-3">Shelf</th>
                            <th className="px-5 py-3 text-right">Stock</th>
                            <th className="px-5 py-3 text-right">Actions</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100">
                          {filteredBooks.map((book) => (
                            <tr key={book.id} className="hover:bg-slate-50/70">
                              <td className="px-5 py-3">
                                <p className="font-semibold text-[#0F1E36]">{book.title}</p>
                                <p className="text-xs text-slate-500">{book.author}</p>
                              </td>
                              <td className="px-5 py-3 font-mono text-xs tabular-nums text-slate-600">
                                {book.isbn}
                              </td>
                              <td className="px-5 py-3 text-xs text-slate-700">{book.categoryName}</td>
                              <td className="px-5 py-3 font-mono text-xs text-slate-600">
                                {book.shelfLocation}
                              </td>
                              <td className="px-5 py-3 text-right font-mono text-xs font-semibold tabular-nums">
                                {book.availableCopies} / {book.totalCopies}
                              </td>
                              <td className="px-5 py-3 text-right">
                                <div className="inline-flex items-center gap-1.5">
                                  <button
                                    type="button"
                                    onClick={() => setSelectedBookForQr(book)}
                                    aria-label={`View QR for ${book.title}`}
                                    className="rounded-md border border-slate-200 p-1.5 text-slate-600 hover:bg-slate-100"
                                  >
                                    <QrCode className="w-4 h-4" />
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => openEditBook(book)}
                                    aria-label={`Edit ${book.title}`}
                                    className="rounded-md border border-slate-200 p-1.5 text-slate-600 hover:bg-slate-100"
                                  >
                                    <Edit3 className="w-4 h-4" />
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => handleDeleteBook(book)}
                                    aria-label={`Delete ${book.title}`}
                                    className="rounded-md border border-red-200 p-1.5 text-red-600 hover:bg-red-50"
                                  >
                                    <Trash2 className="w-4 h-4" />
                                  </button>
                                </div>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                </div>
              )}

              {/* DIGITAL LIBRARY REPOSITORY */}
              {activeTab === 'DIGITAL' && (
                <DigitalLibraryView
                  userRole="LIBRARIAN"
                  categories={categories}
                  onNotify={showToast}
                  onDataChanged={loadAllData}
                />
              )}

              {/* CIRCULATION, APPROVALS & FINES */}
              {activeTab === 'CIRCULATION' && (
                <div className="space-y-4">
                  <div className="flex flex-wrap items-center gap-1.5" role="tablist">
                    {(
                      [
                        { id: 'PENDING', label: `Pending Requests (${pendingTransactions.length})` },
                        { id: 'ACTIVE', label: `Issued & Overdue (${activeTransactions.length})` },
                        { id: 'FINES', label: `Overdue Fines (${fines.length})` },
                        { id: 'ALL', label: `Full History (${transactions.length})` },
                      ] as const
                    ).map((tab) => (
                      <button
                        key={tab.id}
                        type="button"
                        role="tab"
                        aria-selected={circulationFilter === tab.id}
                        onClick={() => setCirculationFilter(tab.id)}
                        className={`rounded-lg px-3.5 py-2 text-xs font-semibold transition-colors whitespace-nowrap ${
                          circulationFilter === tab.id
                            ? 'bg-[#0F1E36] text-white'
                            : 'border border-slate-200 bg-white text-slate-600 hover:bg-slate-100'
                        }`}
                      >
                        {tab.label}
                      </button>
                    ))}
                  </div>

                  {circulationFilter === 'FINES' ? (
                    <div className="rounded-xl border border-slate-200 bg-white overflow-hidden">
                      <table className="w-full text-left text-sm">
                        <thead className="bg-slate-50 text-xs font-semibold text-slate-600 border-b border-slate-200">
                          <tr>
                            <th className="px-5 py-3">Student</th>
                            <th className="px-5 py-3">Book</th>
                            <th className="px-5 py-3 text-right">Overdue Days</th>
                            <th className="px-5 py-3 text-right">Fine Amount</th>
                            <th className="px-5 py-3">Status</th>
                            <th className="px-5 py-3 text-right">Action</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100">
                          {fines.map((f) => (
                            <tr key={f.id}>
                              <td className="px-5 py-3">
                                <p className="font-semibold text-[#0F1E36]">{f.studentName}</p>
                                <p className="text-xs font-mono text-slate-500">{f.enrollmentNumber}</p>
                              </td>
                              <td className="px-5 py-3 text-slate-700">{f.bookTitle}</td>
                              <td className="px-5 py-3 text-right font-mono tabular-nums">{f.daysOverdue}</td>
                              <td className="px-5 py-3 text-right font-mono font-bold tabular-nums">
                                ₹{f.amount.toFixed(2)}
                              </td>
                              <td className="px-5 py-3 text-xs font-semibold">
                                <span className={f.status === 'UNPAID' ? 'text-red-700' : 'text-emerald-700'}>
                                  {f.status}
                                </span>
                              </td>
                              <td className="px-5 py-3 text-right">
                                {f.status === 'UNPAID' && (
                                  <button
                                    type="button"
                                    onClick={() => handleMarkFinePaid(f.id)}
                                    className="rounded-md bg-[#2563EB] px-3 py-1.5 text-xs font-semibold text-white hover:bg-blue-700"
                                  >
                                    Mark Paid
                                  </button>
                                )}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  ) : (
                    <div className="rounded-xl border border-slate-200 bg-white overflow-hidden">
                      <div className="overflow-x-auto">
                        <table className="w-full text-left text-sm">
                          <thead className="bg-slate-50 text-xs font-semibold text-slate-600 border-b border-slate-200">
                            <tr>
                              <th className="px-5 py-3">Student</th>
                              <th className="px-5 py-3">Book</th>
                              <th className="px-5 py-3">Status</th>
                              <th className="px-5 py-3">Due Date</th>
                              <th className="px-5 py-3 text-right">Fine</th>
                              <th className="px-5 py-3 text-right">Actions</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-slate-100">
                            {(circulationFilter === 'PENDING'
                              ? pendingTransactions
                              : circulationFilter === 'ACTIVE'
                                ? activeTransactions
                                : transactions
                            ).map((tx) => (
                              <tr key={tx.id}>
                                <td className="px-5 py-3">
                                  <p className="font-semibold text-[#0F1E36]">{tx.studentName}</p>
                                  <p className="text-xs font-mono text-slate-500">{tx.enrollmentNumber}</p>
                                </td>
                                <td className="px-5 py-3">
                                  <p className="font-medium text-slate-900">{tx.bookTitle}</p>
                                  <p className="text-xs font-mono text-slate-500">{tx.bookIsbn}</p>
                                </td>
                                <td className="px-5 py-3 text-xs font-semibold">
                                  <span
                                    className={
                                      tx.status === 'OVERDUE'
                                        ? 'text-red-700'
                                        : tx.status === 'PENDING'
                                          ? 'text-amber-700'
                                          : tx.status === 'BORROWED'
                                            ? 'text-blue-700'
                                            : 'text-slate-600'
                                    }
                                  >
                                    {tx.status}
                                  </span>
                                </td>
                                <td className="px-5 py-3 font-mono text-xs tabular-nums text-slate-600">
                                  {tx.dueDate ? tx.dueDate.slice(0, 10) : '—'}
                                </td>
                                <td className="px-5 py-3 text-right font-mono text-xs font-semibold tabular-nums">
                                  ₹{tx.calculatedFine.toFixed(2)}
                                </td>
                                <td className="px-5 py-3 text-right">
                                  {tx.status === 'PENDING' && (
                                    <div className="inline-flex items-center gap-2">
                                      <button
                                        type="button"
                                        onClick={() => handleApprove(tx.id)}
                                        className="inline-flex items-center gap-1 rounded-md bg-emerald-600 px-2.5 py-1.5 text-xs font-semibold text-white hover:bg-emerald-700"
                                      >
                                        <Check className="w-3.5 h-3.5" />
                                        Approve
                                      </button>
                                      <button
                                        type="button"
                                        onClick={() => handleReject(tx.id)}
                                        className="rounded-md border border-red-200 px-2.5 py-1.5 text-xs font-semibold text-red-700 hover:bg-red-50"
                                      >
                                        Reject
                                      </button>
                                    </div>
                                  )}
                                  {(tx.status === 'BORROWED' || tx.status === 'OVERDUE') && (
                                    <button
                                      type="button"
                                      onClick={() => handleDeskReturn(tx.id)}
                                      className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-[#0F1E36] hover:bg-slate-50"
                                    >
                                      Mark Returned
                                    </button>
                                  )}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* STUDENT ACCOUNTS MANAGEMENT */}
              {activeTab === 'STUDENTS' && (
                <section className="rounded-xl border border-slate-200 bg-white overflow-hidden">
                  <div className="border-b border-slate-200 px-5 py-4 flex items-center justify-between">
                    <h2 className="font-display text-base font-bold text-[#0F1E36]">
                      Registered Student Accounts
                    </h2>
                    <span className="text-xs text-slate-500 tabular-nums">{students.length} students</span>
                  </div>
                  <div className="overflow-x-auto">
                    <table className="w-full text-left text-sm">
                      <thead className="bg-slate-50 text-xs font-semibold text-slate-600 border-b border-slate-200">
                        <tr>
                          <th className="px-5 py-3">Student</th>
                          <th className="px-5 py-3">Enrollment</th>
                          <th className="px-5 py-3">Department</th>
                          <th className="px-5 py-3 text-right">Active Loans</th>
                          <th className="px-5 py-3 text-right">Unpaid Fines</th>
                          <th className="px-5 py-3">Status</th>
                          <th className="px-5 py-3 text-right">Action</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {students.map((s) => (
                          <tr key={s.id}>
                            <td className="px-5 py-3">
                              <p className="font-semibold text-[#0F1E36]">{s.name}</p>
                              <p className="text-xs text-slate-500">{s.email}</p>
                            </td>
                            <td className="px-5 py-3 font-mono text-xs text-slate-700">{s.enrollmentNumber}</td>
                            <td className="px-5 py-3 text-xs text-slate-700">
                              {s.department} · Sem {s.semester}
                            </td>
                            <td className="px-5 py-3 text-right font-mono tabular-nums">{s.activeBorrows}</td>
                            <td className="px-5 py-3 text-right font-mono tabular-nums">
                              ₹{s.unpaidFines.toFixed(2)}
                            </td>
                            <td className="px-5 py-3 text-xs font-semibold">
                              <span className={s.active ? 'text-emerald-700' : 'text-red-700'}>
                                {s.active ? 'Active' : 'Suspended'}
                              </span>
                            </td>
                            <td className="px-5 py-3 text-right">
                              <button
                                type="button"
                                onClick={() => handleToggleStudent(s.id, s.active)}
                                className="rounded-md border border-slate-300 px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50"
                              >
                                {s.active ? 'Suspend' : 'Activate'}
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </section>
              )}

              {/* SEAT MONITORING */}
              {activeTab === 'SEATS' && (
                <SeatReservationView userRole="LIBRARIAN" onUpdate={loadAllData} />
              )}
            </>
          )}
        </main>
      </div>

      {/* Add / Edit Book Modal */}
      {bookFormOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/50 p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="book-form-title"
        >
          <div className="w-full max-w-lg rounded-xl border border-slate-200 bg-white shadow-xl overflow-hidden">
            <div className="flex items-center justify-between border-b border-slate-200 px-6 py-4 bg-slate-50">
              <h2 id="book-form-title" className="font-display text-lg font-bold text-[#0F1E36]">
                {editingBook ? 'Update Book Record' : 'Add New Book to Catalog'}
              </h2>
              <button
                type="button"
                onClick={() => setBookFormOpen(false)}
                aria-label="Close book form"
                className="rounded-lg p-1.5 text-slate-500 hover:bg-slate-200"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleSaveBook} className="p-6 space-y-4">
              <div>
                <label htmlFor="bf-title" className="block text-xs font-medium text-slate-700 mb-1">
                  Book Title
                </label>
                <input
                  id="bf-title"
                  type="text"
                  required
                  value={fTitle}
                  onChange={(e) => setFTitle(e.target.value)}
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-[#2563EB] focus:outline-none"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label htmlFor="bf-author" className="block text-xs font-medium text-slate-700 mb-1">
                    Author(s)
                  </label>
                  <input
                    id="bf-author"
                    type="text"
                    required
                    value={fAuthor}
                    onChange={(e) => setFAuthor(e.target.value)}
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-[#2563EB] focus:outline-none"
                  />
                </div>
                <div>
                  <label htmlFor="bf-isbn" className="block text-xs font-medium text-slate-700 mb-1">
                    ISBN
                  </label>
                  <input
                    id="bf-isbn"
                    type="text"
                    required
                    value={fIsbn}
                    onChange={(e) => setFIsbn(e.target.value)}
                    placeholder="978-0134685991"
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm font-mono focus:border-[#2563EB] focus:outline-none"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label htmlFor="bf-cat" className="block text-xs font-medium text-slate-700 mb-1">
                    Category
                  </label>
                  <select
                    id="bf-cat"
                    value={fCategoryId}
                    onChange={(e) => setFCategoryId(Number(e.target.value))}
                    className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm focus:border-[#2563EB] focus:outline-none"
                  >
                    {categories.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label htmlFor="bf-shelf" className="block text-xs font-medium text-slate-700 mb-1">
                    Shelf Location
                  </label>
                  <input
                    id="bf-shelf"
                    type="text"
                    required
                    value={fShelf}
                    onChange={(e) => setFShelf(e.target.value)}
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm font-mono focus:border-[#2563EB] focus:outline-none"
                  />
                </div>
              </div>

              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label htmlFor="bf-pub" className="block text-xs font-medium text-slate-700 mb-1">
                    Publisher
                  </label>
                  <input
                    id="bf-pub"
                    type="text"
                    value={fPublisher}
                    onChange={(e) => setFPublisher(e.target.value)}
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-[#2563EB] focus:outline-none"
                  />
                </div>
                <div>
                  <label htmlFor="bf-year" className="block text-xs font-medium text-slate-700 mb-1">
                    Year
                  </label>
                  <input
                    id="bf-year"
                    type="number"
                    value={fYear}
                    onChange={(e) => setFYear(Number(e.target.value))}
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm font-mono focus:border-[#2563EB] focus:outline-none"
                  />
                </div>
                <div>
                  <label htmlFor="bf-copies" className="block text-xs font-medium text-slate-700 mb-1">
                    Total Copies
                  </label>
                  <input
                    id="bf-copies"
                    type="number"
                    min={1}
                    value={fCopies}
                    onChange={(e) => setFCopies(Number(e.target.value))}
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm font-mono focus:border-[#2563EB] focus:outline-none"
                  />
                </div>
              </div>

              <div>
                <label htmlFor="bf-desc" className="block text-xs font-medium text-slate-700 mb-1">
                  Description
                </label>
                <textarea
                  id="bf-desc"
                  rows={3}
                  value={fDesc}
                  onChange={(e) => setFDesc(e.target.value)}
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-[#2563EB] focus:outline-none"
                />
              </div>

              <div className="flex justify-end gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => setBookFormOpen(false)}
                  className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={formSaving}
                  className="rounded-lg bg-[#2563EB] px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-60"
                >
                  {formSaving ? 'Saving...' : editingBook ? 'Save Changes' : 'Add Book'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {selectedBookForQr && (
        <BookDetailModal
          book={selectedBookForQr}
          userRole="LIBRARIAN"
          onClose={() => setSelectedBookForQr(null)}
        />
      )}
    </div>
  );
}
