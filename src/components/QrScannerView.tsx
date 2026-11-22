import { useRef, useState } from 'react';
import jsQR from 'jsqr';
import { ArrowRight, CheckCircle2, QrCode, RotateCcw, ScanLine, Upload } from 'lucide-react';
import type { Book, BorrowTransaction } from '../domain/types';
import { api } from '../services/api';
import { BookCover } from './BookCover';

interface QrScannerViewProps {
  books: Book[];
  onTransactionComplete: () => Promise<void>;
}

export function QrScannerView({ books, onTransactionComplete }: QrScannerViewProps) {
  const [payloadInput, setPayloadInput] = useState('');
  const [scanResult, setScanResult] = useState<{
    book: Book;
    activeTransaction: BorrowTransaction | null;
    suggestedAction: 'BORROW' | 'RETURN' | 'RESERVE';
  } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const verifyPayload = async (raw: string) => {
    setError(null);
    setFeedback(null);
    if (!raw.trim()) {
      setError('Enter a QR code payload or ISBN, or upload a QR label image.');
      return;
    }

    setBusy(true);
    try {
      const res = await api.scanQrPayload(raw.trim());
      setScanResult(res);
    } catch (err) {
      setScanResult(null);
      setError(err instanceof Error ? err.message : 'QR verification failed.');
    } finally {
      setBusy(false);
    }
  };

  const handleImageUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setError(null);
    setFeedback(null);

    const img = new Image();
    const objectUrl = URL.createObjectURL(file);
    img.onload = () => {
      try {
        const canvas = document.createElement('canvas');
        canvas.width = img.width;
        canvas.height = img.height;
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          setError('Canvas decoding unavailable in this browser.');
          return;
        }
        ctx.drawImage(img, 0, 0);
        const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
        const decoded = jsQR(imageData.data, imageData.width, imageData.height);
        if (!decoded?.data) {
          setError('No valid QR code found in the uploaded image.');
          return;
        }
        setPayloadInput(decoded.data);
        verifyPayload(decoded.data);
      } finally {
        URL.revokeObjectURL(objectUrl);
      }
    };
    img.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      setError('Could not read the uploaded image file.');
    };
    img.src = objectUrl;
  };

  const handleQrBorrow = async () => {
    if (!scanResult) return;
    setBusy(true);
    setError(null);
    try {
      const res = await api.borrowBook(scanResult.book.id, 'QR_DIRECT', false);
      setFeedback(
        `Checked out "${scanResult.book.title}". Due back on ${res.transaction.dueDate?.slice(0, 10)}.`
      );
      await onTransactionComplete();
      const updated = await api.scanQrPayload(scanResult.book.qrPayload);
      setScanResult(updated);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to complete QR checkout.');
    } finally {
      setBusy(false);
    }
  };

  const handleQrReturn = async () => {
    if (!scanResult?.activeTransaction) return;
    setBusy(true);
    setError(null);
    try {
      const res = await api.returnBook(scanResult.activeTransaction.id);
      setFeedback(
        res.fineAssessed > 0
          ? `Returned "${scanResult.book.title}". Overdue fine assessed: ₹${res.fineAssessed.toFixed(2)}.`
          : `Returned "${scanResult.book.title}" cleanly on time.`
      );
      await onTransactionComplete();
      const updated = await api.scanQrPayload(scanResult.book.qrPayload);
      setScanResult(updated);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to process QR return.');
    } finally {
      setBusy(false);
    }
  };

  const handleQrReserve = async () => {
    if (!scanResult) return;
    setBusy(true);
    setError(null);
    try {
      await api.reserveBook(scanResult.book.id);
      setFeedback(`Placed waitlist reservation for "${scanResult.book.title}".`);
      await onTransactionComplete();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to place reservation.');
    } finally {
      setBusy(false);
    }
  };

  const sampleCodes = books.slice(0, 4);

  return (
    <div className="space-y-6">
      <div>
        <h2 className="font-display text-xl font-bold text-[#0F1E36]">
          QR Code Circulation Terminal
        </h2>
        <p className="text-sm text-slate-600 mt-1">
          Upload a book QR label image, scan or enter a <span className="font-mono text-xs">SMARTLIB:BOOK</span> code or ISBN, and validate instant borrowing or return against the backend.
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        <div className="lg:col-span-6 rounded-xl border border-slate-200 bg-white p-6 space-y-5">
          <form
            onSubmit={(e) => {
              e.preventDefault();
              verifyPayload(payloadInput);
            }}
            className="space-y-4"
          >
            <div>
              <label htmlFor="qr-payload-input" className="block text-sm font-medium text-slate-700 mb-1.5">
                Book QR Payload or ISBN
              </label>
              <div className="flex gap-2">
                <input
                  id="qr-payload-input"
                  type="text"
                  value={payloadInput}
                  onChange={(e) => setPayloadInput(e.target.value)}
                  placeholder="SMARTLIB:BOOK:1:978-0132350884 or ISBN"
                  className="flex-1 rounded-lg border border-slate-300 px-3.5 py-2.5 text-sm font-mono focus:border-[#2563EB] focus:outline-none focus:ring-2 focus:ring-blue-600/20"
                />
                <button
                  type="submit"
                  disabled={busy}
                  className="inline-flex items-center gap-2 rounded-lg bg-[#2563EB] px-4 py-2.5 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-60 transition-colors whitespace-nowrap"
                >
                  <ScanLine className="w-4 h-4" />
                  Verify QR
                </button>
              </div>
            </div>
          </form>

          <div className="border-t border-slate-100 pt-4">
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              onChange={handleImageUpload}
              className="hidden"
              id="qr-image-upload"
            />
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className="inline-flex w-full items-center justify-center gap-2 rounded-lg border border-dashed border-slate-300 bg-slate-50 px-4 py-3 text-sm font-medium text-slate-700 hover:border-blue-400 hover:bg-blue-50/40 transition-colors"
            >
              <Upload className="w-4 h-4 text-blue-600" />
              Upload Downloaded Book QR Image (.png / .jpg)
            </button>
          </div>

          <div className="border-t border-slate-100 pt-4 space-y-2">
            <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider">
              Quick Scan Test Codes
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {sampleCodes.map((b) => (
                <button
                  key={b.id}
                  type="button"
                  onClick={() => {
                    setPayloadInput(b.qrPayload);
                    verifyPayload(b.qrPayload);
                  }}
                  className="flex items-center justify-between rounded-lg border border-slate-200 bg-white px-3 py-2 text-left hover:border-blue-400 hover:bg-slate-50 transition-colors"
                >
                  <div className="min-w-0 pr-2">
                    <p className="text-xs font-semibold text-[#0F1E36] truncate">{b.title}</p>
                    <p className="text-[11px] font-mono text-slate-500 truncate">{b.qrPayload}</p>
                  </div>
                  <ArrowRight className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Verification Result Panel */}
        <div className="lg:col-span-6 rounded-xl border border-slate-200 bg-white p-6 space-y-4">
          {error && (
            <div role="alert" className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
              {error}
            </div>
          )}

          {feedback && (
            <div role="status" className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800 flex items-center gap-2">
              <CheckCircle2 className="w-4 h-4 shrink-0" />
              <span>{feedback}</span>
            </div>
          )}

          {!scanResult ? (
            <div className="py-10 text-center space-y-3">
              <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-slate-100 text-slate-500">
                <QrCode className="w-6 h-6" />
              </div>
              <p className="text-sm font-semibold text-[#0F1E36]">Ready to Scan</p>
              <p className="text-xs text-slate-500 max-w-xs mx-auto">
                Verify a book QR payload to inspect live copy availability and perform validated checkout or return.
              </p>
            </div>
          ) : (
            <div className="space-y-5">
              <div className="flex gap-4">
                <BookCover
                  src={scanResult.book.coverUrl}
                  title={scanResult.book.title}
                  category={scanResult.book.categoryName}
                  className="w-20 h-28"
                />
                <div className="min-w-0 space-y-1">
                  <p className="text-xs font-medium text-blue-700">{scanResult.book.categoryName}</p>
                  <h3 className="font-display text-lg font-bold text-[#0F1E36]">
                    {scanResult.book.title}
                  </h3>
                  <p className="text-sm text-slate-600">{scanResult.book.author}</p>
                  <p className="text-xs font-mono text-slate-500 tabular-nums">
                    ISBN {scanResult.book.isbn} · Shelf {scanResult.book.shelfLocation}
                  </p>
                  <p className="text-xs font-semibold text-slate-800 pt-1 tabular-nums">
                    Availability: {scanResult.book.availableCopies} / {scanResult.book.totalCopies} copies
                  </p>
                </div>
              </div>

              {scanResult.activeTransaction && (
                <div className="rounded-lg border border-blue-200 bg-blue-50/70 p-3.5 text-xs text-slate-800 space-y-1">
                  <p className="font-semibold text-[#0F1E36]">
                    Active Loan Detected ({scanResult.activeTransaction.status})
                  </p>
                  <p className="tabular-nums">
                    Due Date: {scanResult.activeTransaction.dueDate?.slice(0, 10) ?? 'Pending Desk Approval'}
                  </p>
                </div>
              )}

              <div className="border-t border-slate-100 pt-4 flex flex-wrap gap-3">
                {scanResult.suggestedAction === 'RETURN' && (
                  <button
                    type="button"
                    disabled={busy}
                    onClick={handleQrReturn}
                    className="inline-flex items-center gap-2 rounded-lg bg-[#0F1E36] px-4 py-2.5 text-sm font-semibold text-white hover:bg-[#162B4D] disabled:opacity-60 transition-colors"
                  >
                    <RotateCcw className="w-4 h-4" />
                    Confirm QR Return
                  </button>
                )}

                {scanResult.suggestedAction === 'BORROW' && (
                  <button
                    type="button"
                    disabled={busy}
                    onClick={handleQrBorrow}
                    className="inline-flex items-center gap-2 rounded-lg bg-[#2563EB] px-4 py-2.5 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-60 transition-colors"
                  >
                    <CheckCircle2 className="w-4 h-4" />
                    Confirm QR Borrow (14 Days)
                  </button>
                )}

                {scanResult.suggestedAction === 'RESERVE' && (
                  <button
                    type="button"
                    disabled={busy}
                    onClick={handleQrReserve}
                    className="inline-flex items-center gap-2 rounded-lg bg-[#0F1E36] px-4 py-2.5 text-sm font-semibold text-white hover:bg-[#162B4D] disabled:opacity-60 transition-colors"
                  >
                    Join Waitlist Reservation
                  </button>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
