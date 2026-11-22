export type UserRole = 'STUDENT' | 'LIBRARIAN';

export type BorrowStatus = 'PENDING' | 'BORROWED' | 'RETURNED' | 'REJECTED' | 'OVERDUE';

export type ReservationStatus = 'WAITING' | 'READY' | 'FULFILLED' | 'CANCELLED';

export type FineStatus = 'UNPAID' | 'PAID' | 'WAIVED';

export type SeatBookingStatus = 'ACTIVE' | 'CANCELLED' | 'COMPLETED';

export type DigitalResourceType = 'EBOOK' | 'RESEARCH_PAPER' | 'JOURNAL' | 'LECTURE_NOTES';

export interface DigitalChapter {
  title: string;
  body: string;
}

export interface DigitalResource {
  id: number;
  title: string;
  author: string;
  categoryId: number;
  categoryName: string;
  resourceType: DigitalResourceType;
  publicationYear: number;
  pageCount: number;
  fileFormat: 'PDF' | 'EPUB';
  summary: string;
  chapters: DigitalChapter[];
  downloadCount: number;
  readCount: number;
  isBookmarked: boolean;
  lastChapter: number;
  createdAt: string;
}

export interface UserProfile {
  id: number;
  name: string;
  email: string;
  role: UserRole;
  active: boolean;
  createdAt: string;
  // Student fields
  enrollmentNumber?: string;
  department?: string;
  semester?: number;
  interests?: string[];
  // Librarian fields
  employeeId?: string;
  officeHours?: string;
}

export interface Category {
  id: number;
  name: string;
  description: string;
}

export interface Book {
  id: number;
  isbn: string;
  title: string;
  author: string;
  publisher: string;
  publicationYear: number;
  categoryId: number;
  categoryName: string;
  totalCopies: number;
  availableCopies: number;
  shelfLocation: string;
  description: string;
  coverUrl: string;
  qrPayload: string;
  borrowCount?: number;
}

export interface BorrowTransaction {
  id: number;
  bookId: number;
  bookTitle: string;
  bookAuthor: string;
  bookIsbn: string;
  bookCoverUrl: string;
  categoryName: string;
  studentUserId: number;
  studentName: string;
  studentEmail: string;
  enrollmentNumber: string;
  status: BorrowStatus;
  requestedAt: string;
  issuedAt: string | null;
  dueDate: string | null;
  returnedAt: string | null;
  approvedByName: string | null;
  calculatedFine: number;
  daysOverdue: number;
  daysRemaining: number | null;
}

export interface BookReservation {
  id: number;
  bookId: number;
  bookTitle: string;
  bookAuthor: string;
  bookIsbn: string;
  studentUserId: number;
  studentName: string;
  status: ReservationStatus;
  reservedAt: string;
}

export interface FineRecord {
  id: number;
  transactionId: number;
  bookTitle: string;
  studentUserId: number;
  studentName: string;
  enrollmentNumber: string;
  amount: number;
  daysOverdue: number;
  status: FineStatus;
  assessedAt: string;
  paidAt: string | null;
}

export interface LibrarySeat {
  id: number;
  seatCode: string;
  floor: string;
  zone: string;
  hasPowerOutlet: boolean;
  isQuietZone: boolean;
  isAvailableForSlot?: boolean;
  bookedByCurrentUser?: boolean;
  bookedByName?: string | null;
  currentBookingId?: number | null;
}

export interface SeatBooking {
  id: number;
  seatId: number;
  seatCode: string;
  floor: string;
  zone: string;
  studentUserId: number;
  studentName: string;
  enrollmentNumber: string;
  bookingDate: string;
  timeSlot: string;
  status: SeatBookingStatus;
  createdAt: string;
}

export interface NotificationItem {
  id: number;
  userId: number;
  title: string;
  message: string;
  type: 'DUE_SOON' | 'OVERDUE' | 'RESERVATION' | 'APPROVAL' | 'FINE' | 'SEAT' | 'INFO';
  isRead: boolean;
  createdAt: string;
}

export interface RecommendationItem {
  book: Book;
  score: number;
  reason: string;
}

export interface AnalyticsReport {
  totals: {
    totalBooks: number;
    totalCopies: number;
    availableCopies: number;
    issuedCopies: number;
    overdueCount: number;
    pendingRequests: number;
    activeStudents: number;
    unpaidFinesTotal: number;
    activeSeatBookings: number;
    totalDigitalResources: number;
    totalDigitalReads: number;
  };
  mostBorrowedBooks: Array<{
    bookId: number;
    title: string;
    author: string;
    categoryName: string;
    borrowCount: number;
  }>;
  mostActiveStudents: Array<{
    userId: number;
    name: string;
    enrollmentNumber: string;
    department: string;
    borrowCount: number;
  }>;
  monthlyBorrowing: Array<{
    month: string;
    label: string;
    borrows: number;
    returns: number;
  }>;
  categoryBreakdown: Array<{
    categoryName: string;
    bookCount: number;
    borrowCount: number;
  }>;
}
