import test from 'node:test';
import assert from 'node:assert/strict';
import {
  BookRecommendationEngine,
  DigitalCatalogEngine,
  FineCalculator,
  LibrarianUser,
  QRCodePayloadService,
  SeatReservationValidator,
  StudentUser,
  createDomainUser,
} from './LibraryOOP';
import type { Book, BorrowTransaction, DigitalResource, SeatBooking } from './types';

test('OOP Inheritance and Polymorphism: Student vs Librarian limits and labels', () => {
  const student = new StudentUser(1, 'Arjun Mehta', 'arjun@uni.edu', 'CS2024-01', 'Computer Science', ['Algorithms']);
  const librarian = new LibrarianUser(2, 'Dr. Kavita Rao', 'rao@uni.edu', 'EMP-101');

  assert.equal(student.getMaxBorrowLimit(), 5);
  assert.equal(student.getLoanPeriodDays(), 14);
  assert.equal(student.getPortalLabel(), 'Student Academic Portal');

  assert.equal(librarian.getMaxBorrowLimit(), 15);
  assert.equal(librarian.getLoanPeriodDays(), 30);
  assert.equal(librarian.getPortalLabel(), 'Librarian Administration Console');

  const poly = createDomainUser({
    id: 3,
    name: 'Neha',
    email: 'neha@uni.edu',
    role: 'STUDENT',
    active: true,
    createdAt: '2026-01-01T00:00:00Z',
    enrollmentNumber: 'CS2024-02',
    department: 'Data Science',
    interests: ['AI'],
  });
  assert.equal(poly.getMaxBorrowLimit(), 5);
});

test('FineCalculator computes overdue days, ₹10/day fines, Rupee formatting, and due-soon alerts', () => {
  const issued = '2026-10-01T10:00:00.000Z';
  const due = FineCalculator.calculateDueDate(issued, 14);
  assert.equal(due.startsWith('2026-10-15'), true);

  // On time
  assert.equal(FineCalculator.calculateOverdueDays(due, '2026-10-14T10:00:00.000Z'), 0);
  assert.equal(FineCalculator.isDueSoon(due, '2026-10-13T10:00:00.000Z'), true);
  assert.equal(FineCalculator.isDueSoon(due, '2026-10-05T10:00:00.000Z'), false);

  // 4 days overdue at ₹10/day = ₹40.00
  const overdueDays = FineCalculator.calculateOverdueDays(due, '2026-10-19T10:00:00.000Z');
  assert.equal(overdueDays, 4);
  const amount = FineCalculator.calculateFineAmount(overdueDays);
  assert.equal(amount, 40.0);
  assert.equal(FineCalculator.formatRupees(amount), '₹40.00');
});

test('BookRecommendationEngine ranks interest & borrowing history matches highest and excludes active borrows', () => {
  const books: Book[] = [
    {
      id: 1,
      isbn: '978-0132350884',
      title: 'Clean Code',
      author: 'Robert C. Martin',
      publisher: 'Prentice Hall',
      publicationYear: 2008,
      categoryId: 1,
      categoryName: 'Software Engineering',
      totalCopies: 4,
      availableCopies: 3,
      shelfLocation: 'A-12',
      description: 'Handbook of agile software craftsmanship',
      coverUrl: '',
      qrPayload: 'SMARTLIB:BOOK:1:978-0132350884',
      borrowCount: 12,
    },
    {
      id: 2,
      isbn: '978-0262033848',
      title: 'Introduction to Algorithms',
      author: 'Thomas H. Cormen',
      publisher: 'MIT Press',
      publicationYear: 2022,
      categoryId: 2,
      categoryName: 'Algorithms',
      totalCopies: 5,
      availableCopies: 4,
      shelfLocation: 'B-01',
      description: 'Comprehensive algorithms textbook',
      coverUrl: '',
      qrPayload: 'SMARTLIB:BOOK:2:978-0262033848',
      borrowCount: 18,
    },
    {
      id: 3,
      isbn: '978-0140449136',
      title: 'Meditations',
      author: 'Marcus Aurelius',
      publisher: 'Penguin',
      publicationYear: 2006,
      categoryId: 3,
      categoryName: 'Philosophy',
      totalCopies: 3,
      availableCopies: 2,
      shelfLocation: 'D-04',
      description: 'Stoic reflections',
      coverUrl: '',
      qrPayload: 'SMARTLIB:BOOK:3:978-0140449136',
      borrowCount: 2,
    },
  ];

  const history: BorrowTransaction[] = [
    {
      id: 10,
      bookId: 1,
      bookTitle: 'Clean Code',
      bookAuthor: 'Robert C. Martin',
      bookIsbn: '978-0132350884',
      bookCoverUrl: '',
      categoryName: 'Software Engineering',
      studentUserId: 1,
      studentName: 'Arjun',
      studentEmail: 'arjun@uni.edu',
      enrollmentNumber: 'CS01',
      status: 'BORROWED',
      requestedAt: '2026-11-01T00:00:00Z',
      issuedAt: '2026-11-01T00:00:00Z',
      dueDate: '2026-11-15T00:00:00Z',
      returnedAt: null,
      approvedByName: 'Dr. Rao',
      calculatedFine: 0,
      daysOverdue: 0,
      daysRemaining: 5,
    },
  ];

  const recs = BookRecommendationEngine.recommend(books, ['Algorithms'], history, 4);
  assert.equal(recs.length, 2); // excludes book 1 because currently BORROWED
  assert.equal(recs[0].book.id, 2); // Algorithms interest + popularity wins
  assert.match(recs[0].reason, /Algorithms/);
});

test('QRCodePayloadService builds and parses valid book QR payloads and ISBNs', () => {
  const payload = QRCodePayloadService.buildBookPayload(7, '978-0134685991');
  assert.equal(payload, 'SMARTLIB:BOOK:7:978-0134685991');

  const parsed = QRCodePayloadService.parseBookPayload(payload);
  assert.equal(parsed.valid, true);
  assert.equal(parsed.bookId, 7);
  assert.equal(parsed.isbn, '978-0134685991');

  const isbnParsed = QRCodePayloadService.parseBookPayload('978-0134685991');
  assert.equal(isbnParsed.valid, true);
  assert.equal(isbnParsed.isbn, '978-0134685991');

  assert.equal(QRCodePayloadService.parseBookPayload('INVALID:QR').valid, false);
});

test('SeatReservationValidator prevents double booking seat or slot', () => {
  const existing: Pick<SeatBooking, 'seatId' | 'studentUserId' | 'bookingDate' | 'timeSlot' | 'status'>[] = [
    {
      seatId: 4,
      studentUserId: 10,
      bookingDate: '2026-11-22',
      timeSlot: '10:00 - 12:00',
      status: 'ACTIVE',
    },
  ];

  const seatTaken = SeatReservationValidator.hasSlotConflict(existing, 4, 11, '2026-11-22', '10:00 - 12:00');
  assert.equal(seatTaken.conflict, true);

  const studentBusy = SeatReservationValidator.hasSlotConflict(existing, 5, 10, '2026-11-22', '10:00 - 12:00');
  assert.equal(studentBusy.conflict, true);

  const cancelledOnly = [{ ...existing[0], status: 'CANCELLED' as const }];
  const ok = SeatReservationValidator.hasSlotConflict(cancelledOnly, 4, 11, '2026-11-22', '10:00 - 12:00');
  assert.equal(ok.conflict, false);
});

test('DigitalCatalogEngine filters by type, keyword, and bookmark flag and exports formatted text', () => {
  const resources: DigitalResource[] = [
    {
      id: 1,
      title: 'Java OOP & Design Patterns Handbook',
      author: 'Prof. R. Iyer',
      categoryId: 1,
      categoryName: 'Software Engineering',
      resourceType: 'EBOOK',
      publicationYear: 2025,
      pageCount: 142,
      fileFormat: 'EPUB',
      summary: 'Comprehensive guide to encapsulation and polymorphism.',
      chapters: [{ title: 'Polymorphism', body: 'Runtime dispatch via interfaces.' }],
      downloadCount: 12,
      readCount: 30,
      isBookmarked: true,
      lastChapter: 0,
      createdAt: '2026-11-01T00:00:00Z',
    },
    {
      id: 2,
      title: 'Distributed Consensus Survey',
      author: 'Dr. A. Sen',
      categoryId: 4,
      categoryName: 'Systems Architecture',
      resourceType: 'RESEARCH_PAPER',
      publicationYear: 2024,
      pageCount: 28,
      fileFormat: 'PDF',
      summary: 'Raft and Paxos trade-offs.',
      chapters: [{ title: 'Abstract', body: 'Fault-tolerant state replication.' }],
      downloadCount: 8,
      readCount: 19,
      isBookmarked: false,
      lastChapter: 0,
      createdAt: '2026-11-02T00:00:00Z',
    },
  ];

  assert.equal(DigitalCatalogEngine.filterResources(resources, 'polymorphism', 'ALL', false).length, 1);
  assert.equal(DigitalCatalogEngine.filterResources(resources, '', 'RESEARCH_PAPER', false).length, 1);
  assert.equal(DigitalCatalogEngine.filterResources(resources, '', 'ALL', true).length, 1);

  const exported = DigitalCatalogEngine.buildDownloadableText(resources[0]);
  assert.match(exported, /Chapter 1: Polymorphism/);
  assert.match(exported, /Runtime dispatch via interfaces/);
});
