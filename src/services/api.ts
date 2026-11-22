import type {
  AnalyticsReport,
  Book,
  BookReservation,
  BorrowTransaction,
  Category,
  DigitalChapter,
  DigitalResource,
  DigitalResourceType,
  FineRecord,
  LibrarySeat,
  NotificationItem,
  RecommendationItem,
  SeatBooking,
  UserProfile,
  UserRole,
} from '../domain/types';

let memoryToken: string | null = null;

export function setAuthToken(token: string | null): void {
  memoryToken = token;
}

export function getAuthToken(): string | null {
  return memoryToken;
}

async function apiFetch<T>(url: string, options: RequestInit = {}): Promise<T> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...((options.headers as Record<string, string>) || {}),
  };

  if (memoryToken) {
    headers.Authorization = `Bearer ${memoryToken}`;
  }

  const res = await fetch(url, { ...options, headers });
  const data = (await res.json().catch(() => ({}))) as T & { error?: string };
  if (!res.ok) {
    throw new Error(data.error || `Request failed (${res.status})`);
  }
  return data;
}

export const api = {
  login: (email: string, password: string, portalRole: UserRole) =>
    apiFetch<{ token: string; user: UserProfile }>('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email, password, portalRole }),
    }),

  register: (payload: {
    name: string;
    email: string;
    password: string;
    enrollmentNumber: string;
    department: string;
    semester: number;
    interests: string[];
  }) =>
    apiFetch<{ token: string; user: UserProfile }>('/api/auth/register', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  updateProfile: (payload: {
    name: string;
    department?: string;
    semester?: number;
    interests?: string[];
    officeHours?: string;
  }) =>
    apiFetch<{ user: UserProfile }>('/api/profile', {
      method: 'PUT',
      body: JSON.stringify(payload),
    }),

  getCategories: () => apiFetch<{ categories: Category[] }>('/api/categories'),

  getBooks: (search = '', categoryId?: number) => {
    const params = new URLSearchParams();
    if (search.trim()) params.set('search', search.trim());
    if (categoryId) params.set('categoryId', String(categoryId));
    const qs = params.toString();
    return apiFetch<{ books: Book[] }>(`/api/books${qs ? `?${qs}` : ''}`);
  },

  getBookQr: (bookId: number) =>
    apiFetch<{
      payload: string;
      qrDataUrl: string;
      qrSvg: string;
      bookTitle: string;
      isbn: string;
    }>(`/api/books/${bookId}/qr`),

  createBook: (payload: {
    isbn: string;
    title: string;
    author: string;
    publisher: string;
    publicationYear: number;
    categoryId: number;
    totalCopies: number;
    shelfLocation: string;
    description: string;
  }) =>
    apiFetch<{ book: Book }>('/api/books', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  updateBook: (
    bookId: number,
    payload: {
      isbn: string;
      title: string;
      author: string;
      publisher: string;
      publicationYear: number;
      categoryId: number;
      totalCopies: number;
      shelfLocation: string;
      description: string;
    }
  ) =>
    apiFetch<{ book: Book }>(`/api/books/${bookId}`, {
      method: 'PUT',
      body: JSON.stringify(payload),
    }),

  deleteBook: (bookId: number) =>
    apiFetch<{ deleted: boolean }>(`/api/books/${bookId}`, {
      method: 'DELETE',
    }),

  getRecommendations: () =>
    apiFetch<{ recommendations: RecommendationItem[] }>('/api/recommendations'),

  getTransactions: () => apiFetch<{ transactions: BorrowTransaction[] }>('/api/transactions'),

  borrowBook: (bookId: number, mode: 'REQUEST' | 'QR_DIRECT' = 'REQUEST', requireApproval = false) =>
    apiFetch<{ transaction: BorrowTransaction; instant: boolean }>('/api/borrow', {
      method: 'POST',
      body: JSON.stringify({ bookId, mode, requireApproval }),
    }),

  returnBook: (transactionId: number) =>
    apiFetch<{ returned: boolean; fineAssessed: number }>(`/api/transactions/${transactionId}/return`, {
      method: 'POST',
    }),

  approveTransaction: (transactionId: number) =>
    apiFetch<{ approved: boolean }>(`/api/transactions/${transactionId}/approve`, {
      method: 'POST',
    }),

  rejectTransaction: (transactionId: number) =>
    apiFetch<{ rejected: boolean }>(`/api/transactions/${transactionId}/reject`, {
      method: 'POST',
    }),

  scanQrPayload: (payload: string) =>
    apiFetch<{
      book: Book;
      activeTransaction: BorrowTransaction | null;
      suggestedAction: 'BORROW' | 'RETURN' | 'RESERVE';
    }>('/api/qr/scan', {
      method: 'POST',
      body: JSON.stringify({ payload }),
    }),

  getReservations: () => apiFetch<{ reservations: BookReservation[] }>('/api/reservations'),

  reserveBook: (bookId: number) =>
    apiFetch<{ reservationId: number }>('/api/reservations', {
      method: 'POST',
      body: JSON.stringify({ bookId }),
    }),

  cancelReservation: (reservationId: number) =>
    apiFetch<{ cancelled: boolean }>(`/api/reservations/${reservationId}`, {
      method: 'DELETE',
    }),

  getFines: () => apiFetch<{ fines: FineRecord[] }>('/api/fines'),

  payFine: (fineId: number) =>
    apiFetch<{ paid: boolean }>(`/api/fines/${fineId}/pay`, {
      method: 'POST',
    }),

  getNotifications: () => apiFetch<{ notifications: NotificationItem[] }>('/api/notifications'),

  markNotificationRead: (id: number) =>
    apiFetch<{ read: boolean }>(`/api/notifications/${id}/read`, {
      method: 'POST',
    }),

  getSeats: (date: string, timeSlot: string) => {
    const params = new URLSearchParams({ date, timeSlot });
    return apiFetch<{
      bookingDate: string;
      timeSlot: string;
      timeSlots: string[];
      seats: LibrarySeat[];
      bookings: SeatBooking[];
    }>(`/api/seats?${params.toString()}`);
  },

  bookSeat: (seatId: number, bookingDate: string, timeSlot: string) =>
    apiFetch<{ bookingId: number }>('/api/seats/book', {
      method: 'POST',
      body: JSON.stringify({ seatId, bookingDate, timeSlot }),
    }),

  cancelSeatBooking: (bookingId: number) =>
    apiFetch<{ cancelled: boolean }>(`/api/seats/bookings/${bookingId}`, {
      method: 'DELETE',
    }),

  getStudents: () =>
    apiFetch<{
      students: Array<{
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
      }>;
    }>('/api/students'),

  toggleStudentStatus: (studentId: number, active: boolean) =>
    apiFetch<{ updated: boolean }>(`/api/students/${studentId}/status`, {
      method: 'PATCH',
      body: JSON.stringify({ active }),
    }),

  getAnalytics: () => apiFetch<{ report: AnalyticsReport }>('/api/analytics'),

  getDigitalResources: () => apiFetch<{ resources: DigitalResource[] }>('/api/digital-resources'),

  createDigitalResource: (payload: {
    title: string;
    author: string;
    categoryId: number;
    resourceType: DigitalResourceType;
    publicationYear: number;
    pageCount: number;
    fileFormat: 'PDF' | 'EPUB';
    summary: string;
    chapters: DigitalChapter[];
  }) =>
    apiFetch<{ resource: DigitalResource }>('/api/digital-resources', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  deleteDigitalResource: (resourceId: number) =>
    apiFetch<{ deleted: boolean }>(`/api/digital-resources/${resourceId}`, {
      method: 'DELETE',
    }),

  recordDigitalRead: (resourceId: number, chapterIndex: number, incrementRead = true) =>
    apiFetch<{ readCount: number; lastChapter: number }>(
      `/api/digital-resources/${resourceId}/read`,
      {
        method: 'POST',
        body: JSON.stringify({ chapterIndex, incrementRead }),
      }
    ),

  toggleDigitalBookmark: (resourceId: number) =>
    apiFetch<{ isBookmarked: boolean }>(`/api/digital-resources/${resourceId}/bookmark`, {
      method: 'POST',
    }),

  recordDigitalDownload: (resourceId: number) =>
    apiFetch<{ downloadCount: number }>(`/api/digital-resources/${resourceId}/download`, {
      method: 'POST',
    }),
};
