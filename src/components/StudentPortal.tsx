import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  Armchair,
  Bell,
  BookMarked,
  BookOpen,
  CheckCircle2,
  Clock,
  Compass,
  CreditCard,
  FileText,
  LayoutDashboard,
  LogOut,
  Menu,
  QrCode,
  RotateCcw,
  Search,
  User,
  X,
} from 'lucide-react';
import type {
  Book,
  BookReservation,
  BorrowTransaction,
  Category,
  FineRecord,
  NotificationItem,
  RecommendationItem,
  SeatBooking,
  UserProfile,
} from '../domain/types';
import { api } from '../services/api';
import { BookCover } from './BookCover';
import { BookDetailModal } from './BookDetailModal';
import { DigitalLibraryView } from './DigitalLibraryView';
import { QrScannerView } from './QrScannerView';
import { SeatReservationView } from './SeatReservationView';

type StudentTab = 'OVERVIEW' | 'CATALOG' | 'DIGITAL' | 'LOANS' | 'QR' | 'SEATS' | 'PROFILE';

interface StudentPortalProps {
  user: UserProfile;
  onUserUpdated: (user: UserProfile) => void;
  onLogout: () => void;
}

const ALL_TOPICS = [
  'Software Engineering',
  'Algorithms',
  'Data Science',
  'Systems Architecture',
  'Mathematics',
  'Philosophy',
];

export function StudentPortal({ user, onUserUpdated, onLogout }: StudentPortalProps) {
  const [activeTab, setActiveTab] = useState<StudentTab>('OVERVIEW');
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  const [books, setBooks] = useState<Book[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [recommendations, setRecommendations] = useState<RecommendationItem[]>([]);
  const [transactions, setTransactions] = useState<BorrowTransaction[]>([]);
  const [reservations, setReservations] = useState<BookReservation[]>([]);
  const [fines, setFines] = useState<FineRecord[]>([]);
  const [notifications, setNotifications] = useState<NotificationItem[]>([]);
  const [seatBookings, setSeatBookings] = useState<SeatBooking[]>([]);

  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<number | null>(null);
  const [selectedBook, setSelectedBook] = useState<Book | null>(null);

  const [notifOpen, setNotifOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [toast, setToast] = useState<{ type: 'success' | 'error'; message: string } | null>(null);

  // Profile form state
  const [profName, setProfName] = useState(user.name);
  const [profDept, setProfDept] = useState(user.department || 'Computer Science');
  const [profSem, setProfSem] = useState(user.semester || 1);
  const [profInterests, setProfInterests] = useState<string[]>(user.interests || []);
  const [profSaving, setProfSaving] = useState(false);

  const showToast = useCallback((type: 'success' | 'error', message: string) => {
    setToast({ type, message });
    setTimeout(() => {
      setToast((prev) => (prev?.message === message ? null : prev));
    }, 5000);
  }, []);

  const loadAllData = useCallback(async () => {
    try {
      const now = new Date();
      const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
      const [catRes, bookRes, recRes, txRes, resvRes, fineRes, notifRes, seatRes] =
        await Promise.all([
          api.getCategories(),
          api.getBooks(),
          api.getRecommendations(),
          api.getTransactions(),
          api.getReservations(),
          api.getFines(),
          api.getNotifications(),
          api.getSeats(today, '10:00 - 12:00'),
        ]);
      setCategories(catRes.categories);
      setBooks(bookRes.books);
      setRecommendations(recRes.recommendations);
      setTransactions(txRes.transactions);
      setReservations(resvRes.reservations);
      setFines(fineRes.fines);
      setNotifications(notifRes.notifications);
      setSeatBookings(seatRes.bookings);
    } catch (err) {
      showToast('error', err instanceof Error ? err.message : 'Failed to load library data.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadAllData();
  }, [loadAllData]);

  const activeBorrowedBookIds = useMemo(
    () =>
      new Set(
        transactions
          .filter((t) => t.status === 'BORROWED' || t.status === 'OVERDUE' || t.status === 'PENDING')
          .map((t) => t.bookId)
      ),
    [transactions]
  );

  const filteredBooks = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return books.filter((b) => {
      if (selectedCategory && b.categoryId !== selectedCategory) return false;
      if (!q) return true;
      return (
        b.title.toLowerCase().includes(q) ||
        b.author.toLowerCase().includes(q) ||
        b.isbn.toLowerCase().includes(q) ||
        b.categoryName.toLowerCase().includes(q)
      );
    });
  }, [books, searchQuery, selectedCategory]);

  const activeLoans = transactions.filter(
    (t) => t.status === 'BORROWED' || t.status === 'OVERDUE' || t.status === 'PENDING'
  );
  const dueSoonOrOverdue = transactions.filter(
    (t) =>
      t.status === 'OVERDUE' ||
      (t.status === 'BORROWED' && t.daysRemaining !== null && t.daysRemaining <= 3)
  );
  const unpaidFines = fines.filter((f) => f.status === 'UNPAID');
  const unpaidFineTotal = unpaidFines.reduce((sum, f) => sum + f.amount, 0);
  const activeSeats = seatBookings.filter((s) => s.status === 'ACTIVE');
  const unreadNotifs = notifications.filter((n) => !n.isRead);

  const handleBorrowBook = async (book: Book, requireApproval = false) => {
    try {
      const res = await api.borrowBook(book.id, 'REQUEST', requireApproval);
      showToast(
        'success',
        res.instant
          ? `Borrowed "${book.title}". Due on ${res.transaction.dueDate?.slice(0, 10)}.`
          : `Borrow request submitted for "${book.title}". Awaiting librarian approval.`
      );
      setSelectedBook(null);
      await loadAllData();
    } catch (err) {
      showToast('error', err instanceof Error ? err.message : 'Unable to borrow book.');
    }
  };

  const handleReserveBook = async (book: Book) => {
    try {
      await api.reserveBook(book.id);
      showToast('success', `Added "${book.title}" to your reservation waitlist.`);
      setSelectedBook(null);
      await loadAllData();
    } catch (err) {
      showToast('error', err instanceof Error ? err.message : 'Unable to reserve book.');
    }
  };

  const handleReturnBook = async (tx: BorrowTransaction) => {
    try {
      const res = await api.returnBook(tx.id);
      showToast(
        'success',
        res.fineAssessed > 0
          ? `Returned "${tx.bookTitle}". Overdue fine assessed: ₹${res.fineAssessed.toFixed(2)}.`
          : `Returned "${tx.bookTitle}" successfully.`
      );
      await loadAllData();
    } catch (err) {
      showToast('error', err instanceof Error ? err.message : 'Unable to return book.');
    }
  };

  const handlePayFine = async (fine: FineRecord) => {
    try {
      await api.payFine(fine.id);
      showToast('success', `Fine of ₹${fine.amount.toFixed(2)} paid and cleared.`);
      await loadAllData();
    } catch (err) {
      showToast('error', err instanceof Error ? err.message : 'Payment failed.');
    }
  };

  const handleCancelReservation = async (resId: number) => {
    try {
      await api.cancelReservation(resId);
      showToast('success', 'Book reservation cancelled.');
      await loadAllData();
    } catch (err) {
      showToast('error', err instanceof Error ? err.message : 'Unable to cancel reservation.');
    }
  };

  const handleSaveProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!profName.trim() || !profDept.trim()) {
      showToast('error', 'Name and department are required.');
      return;
    }
    setProfSaving(true);
    try {
      const res = await api.updateProfile({
        name: profName.trim(),
        department: profDept.trim(),
        semester: profSem,
        interests: profInterests,
      });
      onUserUpdated(res.user);
      await loadAllData();
      showToast('success', 'Profile and recommendation interests updated.');
    } catch (err) {
      showToast('error', err instanceof Error ? err.message : 'Unable to update profile.');
    } finally {
      setProfSaving(false);
    }
  };

  const navItems: Array<{ id: StudentTab; label: string; icon: typeof LayoutDashboard }> = [
    { id: 'OVERVIEW', label: 'Dashboard', icon: LayoutDashboard },
    { id: 'CATALOG', label: 'Book Catalog', icon: BookOpen },
    { id: 'DIGITAL', label: 'Digital Library', icon: FileText },
    { id: 'LOANS', label: 'My Loans & Fines', icon: Clock },
    { id: 'QR', label: 'QR Checkout', icon: QrCode },
    { id: 'SEATS', label: 'Seat Reservation', icon: Armchair },
    { id: 'PROFILE', label: 'My Profile', icon: User },
  ];

  const activeNavTitle = navItems.find((i) => i.id === activeTab)?.label ?? 'Dashboard';

  return (
    <div className="min-h-screen bg-slate-50 flex">
      {/* Mobile Sidebar Overlay */}
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

        <nav className="flex-1 px-3 py-5 space-y-1" aria-label="Student Portal Navigation">
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
                className={`flex w-full items-center gap-3 rounded-lg px-3.5 py-2.5 text-sm font-medium whitespace-nowrap ${
                  active
                    ? 'bg-[#2563EB] text-white'
                    : 'text-slate-300 hover:bg-white/10 hover:text-white'
                }`}
              >
                <Icon className="w-4 h-4 shrink-0" />
                <span>{item.label}</span>
              </button>
            );
          })}
        </nav>

        <div className="border-t border-white/10 p-4 space-y-3">
          <div className="px-2">
            <p className="text-sm font-semibold text-white truncate">{user.name}</p>
            <p className="text-xs font-mono text-blue-200 truncate">
              {user.enrollmentNumber} · {user.department}
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

      {/* Main Content Area */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Top Bar */}
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
              <span className="text-slate-500 hidden sm:inline">Student Portal</span>
              <span className="text-slate-300 hidden sm:inline">/</span>
              <h1 className="font-display font-bold text-[#0F1E36] truncate">{activeNavTitle}</h1>
            </div>
          </div>

          <div className="flex items-center gap-3 shrink-0 relative">
            <button
              type="button"
              onClick={() => setNotifOpen((o) => !o)}
              aria-label={`Notifications (${unreadNotifs.length} unread)`}
              className="relative rounded-lg border border-slate-200 bg-white p-2 text-slate-700 hover:bg-slate-50 transition-colors"
            >
              <Bell className="w-4 h-4" />
              {unreadNotifs.length > 0 && (
                <span className="absolute -top-1.5 -right-1.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-[#2563EB] px-1 text-[10px] font-bold text-white tabular-nums">
                  {unreadNotifs.length}
                </span>
              )}
            </button>

            <button
              type="button"
              onClick={() => setActiveTab('QR')}
              className="hidden sm:inline-flex items-center gap-2 rounded-lg bg-[#2563EB] px-3.5 py-2 text-xs font-semibold text-white hover:bg-blue-700 transition-colors whitespace-nowrap"
            >
              <QrCode className="w-3.5 h-3.5" />
              Quick QR Scan
            </button>

            {notifOpen && (
              <div className="absolute right-0 top-12 z-40 w-80 sm:w-96 rounded-xl border border-slate-200 bg-white shadow-xl overflow-hidden">
                <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3 bg-slate-50">
                  <span className="text-xs font-bold text-[#0F1E36]">Alerts & Notifications</span>
                  <button
                    type="button"
                    onClick={() => setNotifOpen(false)}
                    aria-label="Close notifications"
                    className="text-slate-500 hover:text-slate-800"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>
                <div className="max-h-80 overflow-y-auto divide-y divide-slate-100">
                  {notifications.length === 0 ? (
                    <p className="p-4 text-xs text-slate-500 text-center">No notifications yet.</p>
                  ) : (
                    notifications.map((n) => (
                      <div key={n.id} className={`p-3.5 space-y-1 ${n.isRead ? 'bg-white' : 'bg-blue-50/50'}`}>
                        <div className="flex items-start justify-between gap-2">
                          <p className="text-xs font-semibold text-[#0F1E36]">{n.title}</p>
                          {!n.isRead && (
                            <button
                              type="button"
                              onClick={async () => {
                                await api.markNotificationRead(n.id);
                                loadAllData();
                              }}
                              className="text-[11px] font-medium text-[#2563EB] hover:underline shrink-0"
                            >
                              Mark read
                            </button>
                          )}
                        </div>
                        <p className="text-xs text-slate-600">{n.message}</p>
                      </div>
                    ))
                  )}
                </div>
              </div>
            )}
          </div>
        </header>

        {/* Feedback Banner */}
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
                aria-label="Dismiss notification"
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
              {activeTab === 'OVERVIEW' && (
                <div className="space-y-6">
                  {/* 4-Column KPI Strip */}
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                    <div className="rounded-xl border border-slate-200 bg-white p-5">
                      <p className="text-xs font-medium text-slate-500">Active Borrowed Books</p>
                      <p className="mt-2 font-display text-2xl font-bold text-[#0F1E36] tabular-nums">
                        {activeLoans.length} <span className="text-sm font-normal text-slate-400">/ 5 limit</span>
                      </p>
                    </div>
                    <div className="rounded-xl border border-slate-200 bg-white p-5">
                      <p className="text-xs font-medium text-slate-500">Due Soon or Overdue</p>
                      <p
                        className={`mt-2 font-display text-2xl font-bold tabular-nums ${
                          dueSoonOrOverdue.length > 0 ? 'text-amber-700' : 'text-[#0F1E36]'
                        }`}
                      >
                        {dueSoonOrOverdue.length}
                      </p>
                    </div>
                    <div className="rounded-xl border border-slate-200 bg-white p-5">
                      <p className="text-xs font-medium text-slate-500">Pending Fines</p>
                      <p
                        className={`mt-2 font-display text-2xl font-bold tabular-nums ${
                          unpaidFineTotal > 0 ? 'text-red-700' : 'text-emerald-700'
                        }`}
                      >
                        ₹{unpaidFineTotal.toFixed(2)}
                      </p>
                    </div>
                    <div className="rounded-xl border border-slate-200 bg-white p-5">
                      <p className="text-xs font-medium text-slate-500">Reserved Study Seats</p>
                      <p className="mt-2 font-display text-2xl font-bold text-[#0F1E36] tabular-nums">
                        {activeSeats.length}
                      </p>
                    </div>
                  </div>

                  {/* Due-Date & Fine Alerts */}
                  {(dueSoonOrOverdue.length > 0 || unpaidFineTotal > 0) && (
                    <section className="rounded-xl border border-amber-200 bg-amber-50/70 p-5 space-y-3">
                      <div className="flex items-center justify-between gap-4">
                        <div className="flex items-center gap-2 text-amber-900">
                          <AlertTriangle className="w-5 h-5 shrink-0" />
                          <h2 className="font-display text-base font-bold">
                            Automated Due-Date & Fine Alerts
                          </h2>
                        </div>
                        <button
                          type="button"
                          onClick={() => setActiveTab('LOANS')}
                          className="text-xs font-semibold text-[#0F1E36] hover:underline whitespace-nowrap"
                        >
                          Manage Loans & Fines
                        </button>
                      </div>
                      <div className="divide-y divide-amber-200/70">
                        {dueSoonOrOverdue.map((loan) => (
                          <div key={loan.id} className="py-2.5 flex flex-wrap items-center justify-between gap-3 text-sm">
                            <div>
                              <span className="font-semibold text-[#0F1E36]">{loan.bookTitle}</span>
                              <span className="mx-2 text-amber-700">·</span>
                              {loan.status === 'OVERDUE' ? (
                                <span className="font-semibold text-red-700 tabular-nums">
                                  Overdue by {loan.daysOverdue} day(s) · Fine ₹{loan.calculatedFine.toFixed(2)}
                                </span>
                              ) : (
                                <span className="font-medium text-amber-800 tabular-nums">
                                  Due in {loan.daysRemaining} day(s) ({loan.dueDate?.slice(0, 10)})
                                </span>
                              )}
                            </div>
                            <button
                              type="button"
                              onClick={() => handleReturnBook(loan)}
                              className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-[#0F1E36] hover:bg-slate-50"
                            >
                              Return Now
                            </button>
                          </div>
                        ))}
                      </div>
                    </section>
                  )}

                  {/* Feature 1: Intelligent Book Recommendations */}
                  <section className="space-y-4">
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <div>
                        <div className="flex items-center gap-2">
                          <Compass className="w-5 h-5 text-[#2563EB]" />
                          <h2 className="font-display text-lg font-bold text-[#0F1E36]">
                            Intelligent Book Recommendations
                          </h2>
                        </div>
                        <p className="text-xs text-slate-600 mt-0.5">
                          Curated from your academic interests ({(user.interests || []).join(', ') || 'General'}) and borrowing history.
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={() => setActiveTab('CATALOG')}
                        className="text-sm font-semibold text-[#2563EB] hover:underline whitespace-nowrap"
                      >
                        Browse Full Catalog
                      </button>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      {recommendations.map((rec) => (
                        <article
                          key={rec.book.id}
                          className="rounded-xl border border-slate-200 bg-white p-5 flex gap-4 justify-between"
                        >
                          <div className="flex gap-4 min-w-0">
                            <BookCover
                              src={rec.book.coverUrl}
                              title={rec.book.title}
                              category={rec.book.categoryName}
                              className="w-20 h-28"
                            />
                            <div className="min-w-0 space-y-1">
                              <p className="text-xs font-medium text-[#2563EB]">
                                {rec.reason}
                              </p>
                              <h3 className="font-display text-base font-bold text-[#0F1E36] line-clamp-2">
                                {rec.book.title}
                              </h3>
                              <p className="text-xs text-slate-600 truncate">
                                {rec.book.author} · {rec.book.categoryName}
                              </p>
                              <p className="text-xs font-mono text-slate-500 tabular-nums pt-1">
                                {rec.book.availableCopies} of {rec.book.totalCopies} available · Shelf {rec.book.shelfLocation}
                              </p>
                              <div className="pt-2 flex flex-wrap items-center gap-2">
                                <button
                                  type="button"
                                  onClick={() => setSelectedBook(rec.book)}
                                  className="rounded-lg bg-[#0F1E36] px-3 py-1.5 text-xs font-semibold text-white hover:bg-[#162B4D] transition-colors"
                                >
                                  View Details & QR
                                </button>
                                {rec.book.availableCopies > 0 && !activeBorrowedBookIds.has(rec.book.id) && (
                                  <button
                                    type="button"
                                    onClick={() => handleBorrowBook(rec.book, false)}
                                    className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-[#0F1E36] hover:bg-slate-50 transition-colors"
                                  >
                                    Borrow Now
                                  </button>
                                )}
                              </div>
                            </div>
                          </div>
                        </article>
                      ))}
                    </div>
                  </section>
                </div>
              )}

              {activeTab === 'CATALOG' && (
                <div className="space-y-5">
                  <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                    <div className="relative flex-1 max-w-lg">
                      <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
                      <label htmlFor="catalog-search" className="sr-only">
                        Search books by title, author, category, or ISBN
                      </label>
                      <input
                        id="catalog-search"
                        type="search"
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        placeholder="Search by title, author, category, or ISBN..."
                        className="w-full rounded-lg border border-slate-300 bg-white pl-10 pr-4 py-2.5 text-sm focus:border-[#2563EB] focus:outline-none focus:ring-2 focus:ring-blue-600/20"
                      />
                    </div>

                    <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="Filter by category">
                      <button
                        type="button"
                        onClick={() => setSelectedCategory(null)}
                        className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors whitespace-nowrap ${
                          selectedCategory === null
                            ? 'bg-[#0F1E36] text-white'
                            : 'bg-white border border-slate-200 text-slate-600 hover:bg-slate-100'
                        }`}
                      >
                        All Categories
                      </button>
                      {categories.map((cat) => (
                        <button
                          key={cat.id}
                          type="button"
                          onClick={() => setSelectedCategory(cat.id)}
                          className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors whitespace-nowrap ${
                            selectedCategory === cat.id
                              ? 'bg-[#0F1E36] text-white'
                              : 'bg-white border border-slate-200 text-slate-600 hover:bg-slate-100'
                          }`}
                        >
                          {cat.name}
                        </button>
                      ))}
                    </div>
                  </div>

                  {filteredBooks.length === 0 ? (
                    <div className="rounded-xl border border-slate-200 bg-white p-12 text-center space-y-2">
                      <p className="font-display text-base font-bold text-[#0F1E36]">No matching books found</p>
                      <p className="text-sm text-slate-500">
                        Try clearing your search query or switching to All Categories.
                      </p>
                    </div>
                  ) : (
                    <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
                      {filteredBooks.map((book) => {
                        const alreadyHas = activeBorrowedBookIds.has(book.id);
                        return (
                          <article
                            key={book.id}
                            className="rounded-xl border border-slate-200 bg-white p-5 flex flex-col justify-between gap-4"
                          >
                            <div className="flex gap-4">
                              <BookCover
                                src={book.coverUrl}
                                title={book.title}
                                category={book.categoryName}
                                className="w-20 h-28"
                              />
                              <div className="min-w-0 space-y-1">
                                <p className="text-xs font-medium text-[#2563EB]">{book.categoryName}</p>
                                <h3 className="font-display text-base font-bold text-[#0F1E36] line-clamp-2">
                                  {book.title}
                                </h3>
                                <p className="text-xs text-slate-600 truncate">{book.author}</p>
                                <p className="text-[11px] font-mono text-slate-500 tabular-nums">
                                  ISBN {book.isbn} · Shelf {book.shelfLocation}
                                </p>
                              </div>
                            </div>

                            <div className="border-t border-slate-100 pt-3 flex items-center justify-between gap-2">
                              <span
                                className={`text-xs font-semibold tabular-nums ${
                                  book.availableCopies > 0 ? 'text-emerald-700' : 'text-amber-700'
                                }`}
                              >
                                {book.availableCopies > 0
                                  ? `${book.availableCopies}/${book.totalCopies} Available`
                                  : 'Unavailable · Waitlist'}
                              </span>

                              <div className="flex items-center gap-2">
                                <button
                                  type="button"
                                  onClick={() => setSelectedBook(book)}
                                  className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 transition-colors whitespace-nowrap"
                                >
                                  Details & QR
                                </button>

                                {alreadyHas ? (
                                  <span className="text-xs font-semibold text-blue-700 px-2">Active</span>
                                ) : book.availableCopies > 0 ? (
                                  <button
                                    type="button"
                                    onClick={() => handleBorrowBook(book, false)}
                                    className="rounded-lg bg-[#2563EB] px-3 py-1.5 text-xs font-semibold text-white hover:bg-blue-700 transition-colors whitespace-nowrap"
                                  >
                                    Borrow
                                  </button>
                                ) : (
                                  <button
                                    type="button"
                                    onClick={() => handleReserveBook(book)}
                                    className="rounded-lg bg-[#0F1E36] px-3 py-1.5 text-xs font-semibold text-white hover:bg-[#162B4D] transition-colors whitespace-nowrap"
                                  >
                                    Reserve
                                  </button>
                                )}
                              </div>
                            </div>
                          </article>
                        );
                      })}
                    </div>
                  )}
                </div>
              )}

              {activeTab === 'DIGITAL' && (
                <DigitalLibraryView
                  userRole="STUDENT"
                  categories={categories}
                  onNotify={showToast}
                  onDataChanged={loadAllData}
                />
              )}

              {activeTab === 'LOANS' && (
                <div className="space-y-6">
                  {/* Active Loans & Requests */}
                  <section className="rounded-xl border border-slate-200 bg-white overflow-hidden">
                    <div className="border-b border-slate-200 px-5 py-4 flex items-center justify-between">
                      <h2 className="font-display text-base font-bold text-[#0F1E36]">
                        Current Loans & Pending Requests
                      </h2>
                      <span className="text-xs text-slate-500 tabular-nums">{activeLoans.length} active</span>
                    </div>

                    {activeLoans.length === 0 ? (
                      <div className="p-8 text-center text-sm text-slate-500 space-y-2">
                        <p>You have no active borrowed books right now.</p>
                        <button
                          type="button"
                          onClick={() => setActiveTab('CATALOG')}
                          className="rounded-lg bg-[#2563EB] px-4 py-2 text-xs font-semibold text-white hover:bg-blue-700"
                        >
                          Browse Book Catalog
                        </button>
                      </div>
                    ) : (
                      <div className="overflow-x-auto">
                        <table className="w-full text-left text-sm">
                          <thead className="bg-slate-50 text-xs font-semibold text-slate-600 border-b border-slate-200">
                            <tr>
                              <th className="px-5 py-3">Book Title</th>
                              <th className="px-5 py-3">Status</th>
                              <th className="px-5 py-3">Issued</th>
                              <th className="px-5 py-3">Due Date</th>
                              <th className="px-5 py-3 text-right">Fine</th>
                              <th className="px-5 py-3 text-right">Action</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-slate-100">
                            {activeLoans.map((tx) => (
                              <tr key={tx.id} className="hover:bg-slate-50/70">
                                <td className="px-5 py-3.5">
                                  <p className="font-semibold text-[#0F1E36]">{tx.bookTitle}</p>
                                  <p className="text-xs text-slate-500">
                                    {tx.bookAuthor} · <span className="font-mono">{tx.bookIsbn}</span>
                                  </p>
                                </td>
                                <td className="px-5 py-3.5 text-xs font-semibold">
                                  {tx.status === 'OVERDUE' ? (
                                    <span className="text-red-700">
                                      Overdue ({tx.daysOverdue}d)
                                    </span>
                                  ) : tx.status === 'PENDING' ? (
                                    <span className="text-amber-700">Pending Approval</span>
                                  ) : (
                                    <span className="text-emerald-700">
                                      Borrowed · {tx.daysRemaining}d left
                                    </span>
                                  )}
                                </td>
                                <td className="px-5 py-3.5 font-mono text-xs tabular-nums text-slate-600">
                                  {tx.issuedAt ? tx.issuedAt.slice(0, 10) : '—'}
                                </td>
                                <td className="px-5 py-3.5 font-mono text-xs tabular-nums text-slate-700">
                                  {tx.dueDate ? tx.dueDate.slice(0, 10) : '—'}
                                </td>
                                <td className="px-5 py-3.5 text-right font-mono text-xs font-semibold tabular-nums">
                                  ₹{tx.calculatedFine.toFixed(2)}
                                </td>
                                <td className="px-5 py-3.5 text-right">
                                  {(tx.status === 'BORROWED' || tx.status === 'OVERDUE') && (
                                    <button
                                      type="button"
                                      onClick={() => handleReturnBook(tx)}
                                      className="inline-flex items-center gap-1.5 rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-[#0F1E36] hover:bg-slate-50"
                                    >
                                      <RotateCcw className="w-3.5 h-3.5" />
                                      Return Book
                                    </button>
                                  )}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </section>

                  {/* Fines & Reservations Grid */}
                  <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                    <section className="rounded-xl border border-slate-200 bg-white overflow-hidden">
                      <div className="border-b border-slate-200 px-5 py-4 flex items-center justify-between">
                        <h3 className="font-display text-base font-bold text-[#0F1E36]">
                          Automated Fine Ledger
                        </h3>
                        <span className="font-mono text-xs font-semibold text-slate-600 tabular-nums">
                          Unpaid: ₹{unpaidFineTotal.toFixed(2)}
                        </span>
                      </div>
                      {fines.length === 0 ? (
                        <div className="p-6 text-center text-sm text-slate-500">
                          No overdue fines assessed on your account.
                        </div>
                      ) : (
                        <div className="divide-y divide-slate-100">
                          {fines.map((f) => (
                            <div key={f.id} className="px-5 py-3.5 flex items-center justify-between gap-4">
                              <div>
                                <p className="text-sm font-semibold text-[#0F1E36]">{f.bookTitle}</p>
                                <p className="text-xs text-slate-500 tabular-nums">
                                  {f.daysOverdue} overdue day(s) · Assessed {f.assessedAt.slice(0, 10)}
                                </p>
                              </div>
                              <div className="flex items-center gap-3">
                                <span className="font-mono text-sm font-bold text-[#0F1E36] tabular-nums">
                                  ₹{f.amount.toFixed(2)}
                                </span>
                                {f.status === 'UNPAID' ? (
                                  <button
                                    type="button"
                                    onClick={() => handlePayFine(f)}
                                    className="inline-flex items-center gap-1.5 rounded-lg bg-[#2563EB] px-3 py-1.5 text-xs font-semibold text-white hover:bg-blue-700"
                                  >
                                    <CreditCard className="w-3.5 h-3.5" />
                                    Pay Fine
                                  </button>
                                ) : (
                                  <span className="inline-flex items-center gap-1 text-xs font-semibold text-emerald-700">
                                    <CheckCircle2 className="w-3.5 h-3.5" />
                                    {f.status}
                                  </span>
                                )}
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                    </section>

                    <section className="rounded-xl border border-slate-200 bg-white overflow-hidden">
                      <div className="border-b border-slate-200 px-5 py-4 flex items-center justify-between">
                        <h3 className="font-display text-base font-bold text-[#0F1E36]">
                          Book Waitlist Reservations
                        </h3>
                        <span className="text-xs text-slate-500 tabular-nums">
                          {reservations.filter((r) => r.status !== 'CANCELLED').length} entries
                        </span>
                      </div>
                      {reservations.length === 0 ? (
                        <div className="p-6 text-center text-sm text-slate-500">
                          No waitlist reservations. Reserve any unavailable book from the catalog.
                        </div>
                      ) : (
                        <div className="divide-y divide-slate-100">
                          {reservations.map((r) => (
                            <div key={r.id} className="px-5 py-3.5 flex items-center justify-between gap-4">
                              <div>
                                <p className="text-sm font-semibold text-[#0F1E36]">{r.bookTitle}</p>
                                <p className="text-xs text-slate-500">
                                  {r.status} · Reserved {r.reservedAt.slice(0, 10)}
                                </p>
                              </div>
                              {(r.status === 'WAITING' || r.status === 'READY') && (
                                <button
                                  type="button"
                                  onClick={() => handleCancelReservation(r.id)}
                                  className="rounded-md border border-slate-300 px-2.5 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50"
                                >
                                  Cancel
                                </button>
                              )}
                            </div>
                          ))}
                        </div>
                      )}
                    </section>
                  </div>

                  {/* Full Borrowing History */}
                  <section className="rounded-xl border border-slate-200 bg-white overflow-hidden">
                    <div className="border-b border-slate-200 px-5 py-4">
                      <h3 className="font-display text-base font-bold text-[#0F1E36]">
                        Borrowing & Return History
                      </h3>
                    </div>
                    <div className="overflow-x-auto">
                      <table className="w-full text-left text-sm">
                        <thead className="bg-slate-50 text-xs font-semibold text-slate-600 border-b border-slate-200">
                          <tr>
                            <th className="px-5 py-3">Book</th>
                            <th className="px-5 py-3">Category</th>
                            <th className="px-5 py-3">Requested</th>
                            <th className="px-5 py-3">Returned</th>
                            <th className="px-5 py-3">Status</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100">
                          {transactions.map((tx) => (
                            <tr key={tx.id}>
                              <td className="px-5 py-3 font-medium text-[#0F1E36]">{tx.bookTitle}</td>
                              <td className="px-5 py-3 text-xs text-slate-600">{tx.categoryName}</td>
                              <td className="px-5 py-3 font-mono text-xs tabular-nums text-slate-600">
                                {tx.requestedAt.slice(0, 10)}
                              </td>
                              <td className="px-5 py-3 font-mono text-xs tabular-nums text-slate-600">
                                {tx.returnedAt ? tx.returnedAt.slice(0, 10) : '—'}
                              </td>
                              <td className="px-5 py-3 text-xs font-semibold text-slate-700">{tx.status}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </section>
                </div>
              )}

              {activeTab === 'QR' && (
                <QrScannerView books={books} onTransactionComplete={loadAllData} />
              )}

              {activeTab === 'SEATS' && (
                <SeatReservationView userRole="STUDENT" onUpdate={loadAllData} />
              )}

              {activeTab === 'PROFILE' && (
                <section className="max-w-2xl rounded-xl border border-slate-200 bg-white p-6 space-y-6">
                  <div>
                    <h2 className="font-display text-lg font-bold text-[#0F1E36]">
                      Student Academic Profile
                    </h2>
                    <p className="text-xs text-slate-600 mt-1">
                      Update your department and reading interests to refine personalized book recommendations.
                    </p>
                  </div>

                  <form onSubmit={handleSaveProfile} className="space-y-4">
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                      <div>
                        <label htmlFor="prof-name" className="block text-xs font-medium text-slate-700 mb-1">
                          Full Name
                        </label>
                        <input
                          id="prof-name"
                          type="text"
                          value={profName}
                          onChange={(e) => setProfName(e.target.value)}
                          className="w-full rounded-lg border border-slate-300 px-3.5 py-2 text-sm focus:border-[#2563EB] focus:outline-none"
                        />
                      </div>
                      <div>
                        <label htmlFor="prof-email" className="block text-xs font-medium text-slate-700 mb-1">
                          Academic Email (Read-Only)
                        </label>
                        <input
                          id="prof-email"
                          type="email"
                          disabled
                          value={user.email}
                          className="w-full rounded-lg border border-slate-200 bg-slate-50 px-3.5 py-2 text-sm text-slate-500"
                        />
                      </div>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                      <div>
                        <label htmlFor="prof-enroll" className="block text-xs font-medium text-slate-700 mb-1">
                          Enrollment ID
                        </label>
                        <input
                          id="prof-enroll"
                          type="text"
                          disabled
                          value={user.enrollmentNumber || ''}
                          className="w-full rounded-lg border border-slate-200 bg-slate-50 px-3.5 py-2 text-sm font-mono text-slate-500"
                        />
                      </div>
                      <div>
                        <label htmlFor="prof-dept" className="block text-xs font-medium text-slate-700 mb-1">
                          Department
                        </label>
                        <input
                          id="prof-dept"
                          type="text"
                          value={profDept}
                          onChange={(e) => setProfDept(e.target.value)}
                          className="w-full rounded-lg border border-slate-300 px-3.5 py-2 text-sm focus:border-[#2563EB] focus:outline-none"
                        />
                      </div>
                      <div>
                        <label htmlFor="prof-sem" className="block text-xs font-medium text-slate-700 mb-1">
                          Semester
                        </label>
                        <select
                          id="prof-sem"
                          value={profSem}
                          onChange={(e) => setProfSem(Number(e.target.value))}
                          className="w-full rounded-lg border border-slate-300 bg-white px-3.5 py-2 text-sm focus:border-[#2563EB] focus:outline-none"
                        >
                          {[1, 2, 3, 4, 5, 6, 7, 8].map((s) => (
                            <option key={s} value={s}>
                              Semester {s}
                            </option>
                          ))}
                        </select>
                      </div>
                    </div>

                    <div>
                      <span className="block text-xs font-medium text-slate-700 mb-2">
                        Preferred Recommendation Subjects
                      </span>
                      <div className="flex flex-wrap gap-2">
                        {ALL_TOPICS.map((topic) => {
                          const selected = profInterests.includes(topic);
                          return (
                            <button
                              key={topic}
                              type="button"
                              onClick={() =>
                                setProfInterests((prev) =>
                                  prev.includes(topic) ? prev.filter((x) => x !== topic) : [...prev, topic]
                                )
                              }
                              className={`rounded-lg border px-3 py-1.5 text-xs font-semibold transition-colors ${
                                selected
                                  ? 'border-[#2563EB] bg-blue-50 text-[#2563EB]'
                                  : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50'
                              }`}
                            >
                              {topic}
                            </button>
                          );
                        })}
                      </div>
                    </div>

                    <div className="pt-2">
                      <button
                        type="submit"
                        disabled={profSaving}
                        className="rounded-lg bg-[#2563EB] px-5 py-2.5 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-60 transition-colors"
                      >
                        {profSaving ? 'Saving Changes...' : 'Save Profile'}
                      </button>
                    </div>
                  </form>
                </section>
              )}
            </>
          )}
        </main>
      </div>

      {selectedBook && (
        <BookDetailModal
          book={selectedBook}
          userRole="STUDENT"
          alreadyBorrowed={activeBorrowedBookIds.has(selectedBook.id)}
          onClose={() => setSelectedBook(null)}
          onBorrow={handleBorrowBook}
          onReserve={handleReserveBook}
        />
      )}
    </div>
  );
}
