import type {
  Book,
  BorrowTransaction,
  DigitalResource,
  DigitalResourceType,
  RecommendationItem,
  SeatBooking,
  UserProfile,
  UserRole,
} from './types';

/**
 * Abstraction & Encapsulation:
 * Abstract base User entity mirrored with our Java OOP User.java class.
 */
export abstract class AbstractUser {
  #id: number;
  #name: string;
  #email: string;
  #role: UserRole;

  constructor(id: number, name: string, email: string, role: UserRole) {
    this.#id = id;
    this.#name = name;
    this.#email = email;
    this.#role = role;
  }

  public getId(): number {
    return this.#id;
  }

  public getName(): string {
    return this.#name;
  }

  public setName(name: string): void {
    if (!name.trim()) throw new Error('Name cannot be empty');
    this.#name = name.trim();
  }

  public getEmail(): string {
    return this.#email;
  }

  public getRole(): UserRole {
    return this.#role;
  }

  // Polymorphic abstract contracts
  public abstract getMaxBorrowLimit(): number;
  public abstract getLoanPeriodDays(): number;
  public abstract getPortalLabel(): string;
}

export class StudentUser extends AbstractUser {
  #enrollmentNumber: string;
  #department: string;
  #interests: string[];

  constructor(
    id: number,
    name: string,
    email: string,
    enrollmentNumber: string,
    department: string,
    interests: string[] = []
  ) {
    super(id, name, email, 'STUDENT');
    this.#enrollmentNumber = enrollmentNumber;
    this.#department = department;
    this.#interests = interests;
  }

  public getEnrollmentNumber(): string {
    return this.#enrollmentNumber;
  }

  public getDepartment(): string {
    return this.#department;
  }

  public getInterests(): string[] {
    return [...this.#interests];
  }

  public override getMaxBorrowLimit(): number {
    return 5;
  }

  public override getLoanPeriodDays(): number {
    return 14;
  }

  public override getPortalLabel(): string {
    return 'Student Academic Portal';
  }
}

export class LibrarianUser extends AbstractUser {
  #employeeId: string;

  constructor(id: number, name: string, email: string, employeeId: string) {
    super(id, name, email, 'LIBRARIAN');
    this.#employeeId = employeeId;
  }

  public getEmployeeId(): string {
    return this.#employeeId;
  }

  public override getMaxBorrowLimit(): number {
    return 15;
  }

  public override getLoanPeriodDays(): number {
    return 30;
  }

  public override getPortalLabel(): string {
    return 'Librarian Administration Console';
  }
}

export function createDomainUser(profile: UserProfile): AbstractUser {
  if (profile.role === 'LIBRARIAN') {
    return new LibrarianUser(
      profile.id,
      profile.name,
      profile.email,
      profile.employeeId ?? 'LIB-001'
    );
  }
  return new StudentUser(
    profile.id,
    profile.name,
    profile.email,
    profile.enrollmentNumber ?? 'STU-000',
    profile.department ?? 'General Studies',
    profile.interests ?? []
  );
}

/**
 * Feature 3: Automated Due-Date and Fine Management (INR / Rupees)
 */
export class FineCalculator {
  public static readonly DAILY_FINE_RATE = 10.0;
  public static readonly DUE_SOON_THRESHOLD_DAYS = 3;

  public static formatRupees(amount: number): string {
    return `₹${amount.toFixed(2)}`;
  }

  public static calculateDueDate(issuedAtIso: string, loanDays = 14): string {
    const issued = new Date(issuedAtIso);
    const due = new Date(issued.getTime() + loanDays * 86_400_000);
    return due.toISOString();
  }

  public static calculateOverdueDays(dueDateIso: string, referenceIso?: string): number {
    const due = new Date(dueDateIso).getTime();
    const ref = referenceIso ? new Date(referenceIso).getTime() : Date.now();
    if (Number.isNaN(due) || Number.isNaN(ref) || ref <= due) {
      return 0;
    }
    const diffDays = Math.floor((ref - due) / 86_400_000);
    return Math.max(0, diffDays);
  }

  public static calculateFineAmount(overdueDays: number, dailyRate = FineCalculator.DAILY_FINE_RATE): number {
    if (overdueDays <= 0) return 0;
    return Number((overdueDays * dailyRate).toFixed(2));
  }

  public static getDaysRemaining(dueDateIso: string, referenceIso?: string): number {
    const due = new Date(dueDateIso).getTime();
    const ref = referenceIso ? new Date(referenceIso).getTime() : Date.now();
    return Math.ceil((due - ref) / 86_400_000);
  }

  public static isDueSoon(dueDateIso: string, referenceIso?: string): boolean {
    const remaining = FineCalculator.getDaysRemaining(dueDateIso, referenceIso);
    return remaining >= 0 && remaining <= FineCalculator.DUE_SOON_THRESHOLD_DAYS;
  }
}

/**
 * Feature 1: Intelligent Book Recommendations
 * Scores books based on student's explicit interests, past borrowed categories,
 * author affinity, and overall catalog popularity.
 */
export class BookRecommendationEngine {
  public static recommend(
    allBooks: Book[],
    studentInterests: string[],
    borrowHistory: BorrowTransaction[],
    limit = 4
  ): RecommendationItem[] {
    const activeBookIds = new Set(
      borrowHistory
        .filter((t) => t.status === 'BORROWED' || t.status === 'PENDING' || t.status === 'OVERDUE')
        .map((t) => t.bookId)
    );

    const borrowedCategoryCounts = new Map<string, number>();
    const borrowedAuthors = new Set<string>();
    for (const tx of borrowHistory) {
      if (tx.status !== 'REJECTED') {
        const cat = tx.categoryName.toLowerCase();
        borrowedCategoryCounts.set(cat, (borrowedCategoryCounts.get(cat) ?? 0) + 1);
        borrowedAuthors.add(tx.bookAuthor.toLowerCase());
      }
    }

    const normalizedInterests = studentInterests.map((i) => i.trim().toLowerCase()).filter(Boolean);

    const scored: RecommendationItem[] = [];

    for (const book of allBooks) {
      if (activeBookIds.has(book.id)) continue;

      let score = 0;
      const reasons: string[] = [];
      const bookCat = book.categoryName.toLowerCase();
      const bookAuthor = book.author.toLowerCase();
      const titleLower = book.title.toLowerCase();

      // 1. Direct interest match
      const interestMatch = normalizedInterests.find(
        (interest) =>
          bookCat.includes(interest) ||
          interest.includes(bookCat) ||
          titleLower.includes(interest) ||
          book.description.toLowerCase().includes(interest)
      );
      if (interestMatch) {
        score += 45;
        reasons.push(`Matches your interest in ${book.categoryName}`);
      }

      // 2. Borrowing pattern category affinity
      const catHistoryCount = borrowedCategoryCounts.get(bookCat) ?? 0;
      if (catHistoryCount > 0) {
        score += Math.min(35, catHistoryCount * 18);
        if (!reasons.length) {
          reasons.push(`Based on your ${book.categoryName} reading history`);
        }
      }

      // 3. Author affinity
      if (borrowedAuthors.has(bookAuthor)) {
        score += 25;
        reasons.push(`Same author as books you borrowed (${book.author})`);
      }

      // 4. Popularity & immediate availability bonus
      const popularity = book.borrowCount ?? 0;
      score += Math.min(20, popularity * 2);
      if (book.availableCopies > 0) {
        score += 8;
      }

      if (reasons.length === 0) {
        reasons.push(
          popularity > 0
            ? `Popular in ${book.categoryName} (${popularity} borrows)`
            : `Recommended addition in ${book.categoryName}`
        );
      }

      scored.push({
        book,
        score,
        reason: reasons[0],
      });
    }

    return scored
      .sort((a, b) => b.score - a.score || b.book.availableCopies - a.book.availableCopies)
      .slice(0, limit);
  }
}

/**
 * Feature 2: QR Code-Based Book Management
 */
export class QRCodePayloadService {
  public static buildBookPayload(bookId: number, isbn: string): string {
    return `SMARTLIB:BOOK:${bookId}:${isbn.trim()}`;
  }

  public static parseBookPayload(rawPayload: string): { bookId?: number; isbn?: string; valid: boolean } {
    const trimmed = rawPayload.trim();
    if (!trimmed) return { valid: false };

    const match = /^SMARTLIB:BOOK:(\d+):([0-9Xx-]+)$/.exec(trimmed);
    if (match) {
      return {
        valid: true,
        bookId: Number(match[1]),
        isbn: match[2],
      };
    }

    // Allow direct ISBN scan fallback (e.g., barcode/ISBN-13 entry)
    const isbnOnly = /^([0-9Xx-]{10,17})$/.exec(trimmed);
    if (isbnOnly) {
      return {
        valid: true,
        isbn: isbnOnly[1],
      };
    }

    return { valid: false };
  }
}

/**
 * Feature 4: Smart Library Seat Reservation
 */
export const LIBRARY_TIME_SLOTS = [
  '08:00 - 10:00',
  '10:00 - 12:00',
  '12:00 - 14:00',
  '14:00 - 16:00',
  '16:00 - 18:00',
  '18:00 - 20:00',
] as const;

export class SeatReservationValidator {
  public static hasSlotConflict(
    existingBookings: Pick<SeatBooking, 'seatId' | 'studentUserId' | 'bookingDate' | 'timeSlot' | 'status'>[],
    seatId: number,
    studentUserId: number,
    bookingDate: string,
    timeSlot: string
  ): { conflict: boolean; reason?: string } {
    const active = existingBookings.filter(
      (b) => b.status === 'ACTIVE' && b.bookingDate === bookingDate && b.timeSlot === timeSlot
    );

    if (active.some((b) => b.seatId === seatId)) {
      return {
        conflict: true,
        reason: 'This seat is already reserved for the selected date and time slot.',
      };
    }

    if (active.some((b) => b.studentUserId === studentUserId)) {
      return {
        conflict: true,
        reason: 'You already hold an active seat reservation for this time slot.',
      };
    }

    return { conflict: false };
  }
}

/**
 * Digital Library Repository filtering & study export helper
 */
export class DigitalCatalogEngine {
  public static filterResources(
    resources: DigitalResource[],
    query: string,
    typeFilter: DigitalResourceType | 'ALL',
    bookmarkedOnly = false
  ): DigitalResource[] {
    const q = query.trim().toLowerCase();
    return resources.filter((res) => {
      if (bookmarkedOnly && !res.isBookmarked) return false;
      if (typeFilter !== 'ALL' && res.resourceType !== typeFilter) return false;
      if (!q) return true;
      return (
        res.title.toLowerCase().includes(q) ||
        res.author.toLowerCase().includes(q) ||
        res.categoryName.toLowerCase().includes(q) ||
        res.summary.toLowerCase().includes(q)
      );
    });
  }

  public static buildDownloadableText(resource: DigitalResource): string {
    const lines: string[] = [
      resource.title,
      `Author: ${resource.author}`,
      `Category: ${resource.categoryName} | Type: ${resource.resourceType} | Year: ${resource.publicationYear}`,
      '='.repeat(64),
      '',
      resource.summary,
      '',
    ];
    resource.chapters.forEach((ch, idx) => {
      lines.push(`Chapter ${idx + 1}: ${ch.title}`);
      lines.push('-'.repeat(40));
      lines.push(ch.body);
      lines.push('');
    });
    return lines.join('\n');
  }
}
