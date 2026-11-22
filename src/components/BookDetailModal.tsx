import { useEffect, useState } from 'react';
import { BookmarkPlus, CheckCircle2, Download, QrCode, X } from 'lucide-react';
import type { Book, UserRole } from '../domain/types';
import { api } from '../services/api';
import { BookCover } from './BookCover';

interface BookDetailModalProps {
  book: Book;
  userRole: UserRole;
  alreadyBorrowed?: boolean;
  onClose: () => void;
  onBorrow?: (book: Book, requireApproval?: boolean) => Promise<void>;
  onReserve?: (book: Book) => Promise<void>;
}

export function BookDetailModal({
  book,
  userRole,
  alreadyBorrowed,
  onClose,
  onBorrow,
  onReserve,
}: BookDetailModalProps) {
  const [qrDataUrl, setQrDataUrl] = useState<string>('');
  const [qrPayload, setQrPayload] = useState<string>(book.qrPayload);
  const [qrLoading, setQrLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let active = true;
    setQrLoading(true);
    api
      .getBookQr(book.id)
      .then((res) => {
        if (active) {
          setQrDataUrl(res.qrDataUrl);
          setQrPayload(res.payload);
        }
      })
      .finally(() => {
        if (active) setQrLoading(false);
      });
    return () => {
      active = false;
    };
  }, [book.id]);

  const handleAction = async (fn?: () => Promise<void> | undefined) => {
    if (!fn) return;
    setBusy(true);
    try {
      await fn();
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/50 p-4 backdrop-blur-[1px]"
      role="dialog"
      aria-modal="true"
      aria-labelledby="book-detail-title"
    >
      <div className="w-full max-w-2xl rounded-xl border border-slate-200 bg-white shadow-xl overflow-hidden">
        <div className="flex items-center justify-between border-b border-slate-200 px-6 py-4 bg-slate-50">
          <div className="min-w-0 pr-4">
            <p className="text-xs font-medium text-blue-700">{book.categoryName}</p>
            <h2 id="book-detail-title" className="text-lg font-bold text-[#0F1E36] truncate">
              {book.title}
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close book details"
            className="rounded-lg p-2 text-slate-500 hover:bg-slate-200/70 hover:text-slate-900 transition-colors focus-visible:outline-2 focus-visible:outline-blue-600"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-12 gap-6 p-6">
          <div className="md:col-span-7 space-y-4">
            <div className="flex gap-4">
              <BookCover src={book.coverUrl} title={book.title} category={book.categoryName} className="w-24 h-32" />
              <div className="space-y-1.5 min-w-0">
                <p className="text-sm font-semibold text-slate-900">{book.author}</p>
                <p className="text-xs text-slate-600">
                  {book.publisher} · {book.publicationYear}
                </p>
                <p className="text-xs font-mono text-slate-600 tabular-nums">ISBN {book.isbn}</p>
                <p className="text-xs font-mono text-slate-600">Shelf {book.shelfLocation}</p>
                <div className="pt-1 flex items-center gap-2 text-xs font-medium">
                  {book.availableCopies > 0 ? (
                    <span className="inline-flex items-center gap-1.5 text-emerald-700">
                      <CheckCircle2 className="w-4 h-4" />
                      <span className="tabular-nums">
                        {book.availableCopies} of {book.totalCopies} copies available
                      </span>
                    </span>
                  ) : (
                    <span className="text-amber-700 font-semibold tabular-nums">
                      0 of {book.totalCopies} copies available · Waitlist open
                    </span>
                  )}
                </div>
              </div>
            </div>

            <div className="border-t border-slate-100 pt-4">
              <h3 className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1.5">
                Synopsis
              </h3>
              <p className="text-sm text-slate-700 leading-relaxed">{book.description}</p>
            </div>

            {userRole === 'STUDENT' && (
              <div className="border-t border-slate-100 pt-4 flex flex-wrap items-center gap-3">
                {alreadyBorrowed ? (
                  <span className="text-sm font-medium text-blue-700">
                    You currently have an active loan or pending request for this title.
                  </span>
                ) : book.availableCopies > 0 ? (
                  <>
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => handleAction(() => onBorrow?.(book, false))}
                      className="inline-flex items-center gap-2 rounded-lg bg-[#2563EB] px-4 py-2.5 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-60 transition-colors whitespace-nowrap"
                    >
                      Borrow Book (14 Days)
                    </button>
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => handleAction(() => onBorrow?.(book, true))}
                      className="inline-flex items-center gap-2 rounded-lg border border-slate-300 bg-white px-4 py-2.5 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-60 transition-colors whitespace-nowrap"
                    >
                      Submit Desk Request
                    </button>
                  </>
                ) : (
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => handleAction(() => onReserve?.(book))}
                    className="inline-flex items-center gap-2 rounded-lg bg-[#0F1E36] px-4 py-2.5 text-sm font-semibold text-white hover:bg-[#162B4D] disabled:opacity-60 transition-colors whitespace-nowrap"
                  >
                    <BookmarkPlus className="w-4 h-4" />
                    Reserve Unavailable Book
                  </button>
                )}
              </div>
            )}
          </div>

          <div className="md:col-span-5 flex flex-col items-center justify-between rounded-lg border border-slate-200 bg-slate-50 p-4 text-center">
            <div className="flex items-center gap-1.5 text-xs font-semibold text-[#0F1E36]">
              <QrCode className="w-4 h-4 text-blue-600" />
              Book QR Identifier
            </div>

            <div className="my-3 flex items-center justify-center rounded-lg border border-slate-200 bg-white p-3 w-44 h-44">
              {qrLoading ? (
                <div className="h-32 w-32 animate-pulse rounded bg-slate-100" />
              ) : qrDataUrl ? (
                <img src={qrDataUrl} alt={`QR Code for ${book.title}`} className="w-36 h-36" />
              ) : (
                <span className="text-xs text-slate-500">QR unavailable</span>
              )}
            </div>

            <div className="w-full space-y-2">
              <p className="font-mono text-[10.5px] text-slate-600 whitespace-nowrap overflow-x-auto select-all bg-white border border-slate-200 rounded px-2.5 py-1.5">
                {qrPayload}
              </p>
              {qrDataUrl && (
                <a
                  href={qrDataUrl}
                  download={`book-qr-${book.id}.png`}
                  className="inline-flex w-full items-center justify-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-medium text-slate-700 hover:bg-slate-100 transition-colors"
                >
                  <Download className="w-3.5 h-3.5" />
                  Download QR Label
                </a>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
