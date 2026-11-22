import { useCallback, useEffect, useState } from 'react';
import { Armchair, Calendar, CheckCircle2, Clock, PlugZap, VolumeX, XCircle } from 'lucide-react';
import type { LibrarySeat, SeatBooking, UserRole } from '../domain/types';
import { LIBRARY_TIME_SLOTS } from '../domain/LibraryOOP';
import { api } from '../services/api';

interface SeatReservationViewProps {
  userRole: UserRole;
  onUpdate?: () => void;
}

function getLocalTodayDate(): string {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export function SeatReservationView({ userRole, onUpdate }: SeatReservationViewProps) {
  const [selectedDate, setSelectedDate] = useState(getLocalTodayDate);
  const [selectedSlot, setSelectedSlot] = useState<string>(LIBRARY_TIME_SLOTS[1]);
  const [seats, setSeats] = useState<LibrarySeat[]>([]);
  const [bookings, setBookings] = useState<SeatBooking[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedSeat, setSelectedSeat] = useState<LibrarySeat | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const loadSeats = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await api.getSeats(selectedDate, selectedSlot);
      setSeats(res.seats);
      setBookings(res.bookings);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to load reading room seats.');
    } finally {
      setLoading(false);
    }
  }, [selectedDate, selectedSlot]);

  useEffect(() => {
    loadSeats();
  }, [loadSeats]);

  const handleBookSeat = async () => {
    if (!selectedSeat) return;
    setBusy(true);
    setError(null);
    setFeedback(null);
    try {
      await api.bookSeat(selectedSeat.id, selectedDate, selectedSlot);
      setFeedback(
        `Seat ${selectedSeat.seatCode} (${selectedSeat.floor}) reserved for ${selectedDate} · ${selectedSlot}.`
      );
      setSelectedSeat(null);
      await loadSeats();
      onUpdate?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to reserve seat.');
    } finally {
      setBusy(false);
    }
  };

  const handleCancelBooking = async (bookingId: number, seatCode: string) => {
    setBusy(true);
    setError(null);
    setFeedback(null);
    try {
      await api.cancelSeatBooking(bookingId);
      setFeedback(`Cancelled reservation for seat ${seatCode}.`);
      await loadSeats();
      onUpdate?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to cancel reservation.');
    } finally {
      setBusy(false);
    }
  };

  const floor1Seats = seats.filter((s) => s.floor === 'Floor 1');
  const floor2Seats = seats.filter((s) => s.floor === 'Floor 2');
  const availableCount = seats.filter((s) => s.isAvailableForSlot).length;
  const activeBookings = bookings.filter((b) => b.status === 'ACTIVE');

  return (
    <div className="space-y-6">
      <div className="flex flex-col md:flex-row md:items-end justify-between gap-4">
        <div>
          <h2 className="font-display text-xl font-bold text-[#0F1E36]">
            Smart Library Seat Reservation
          </h2>
          <p className="text-sm text-slate-600 mt-1">
            View live occupancy by floor and reserve a study desk for a specific 2-hour slot. Double-booking is prevented automatically.
          </p>
        </div>

        <div className="flex flex-wrap sm:flex-nowrap items-end gap-3 shrink-0">
          <div>
            <label htmlFor="seat-date" className="block text-xs font-medium text-slate-600 mb-1">
              Date
            </label>
            <div className="relative">
              <Calendar className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
              <input
                id="seat-date"
                type="date"
                value={selectedDate}
                onChange={(e) => {
                  setSelectedDate(e.target.value);
                  setSelectedSeat(null);
                }}
                className="rounded-lg border border-slate-300 bg-white pl-9 pr-3 py-2 text-sm font-mono tabular-nums focus:border-[#2563EB] focus:outline-none"
              />
            </div>
          </div>

          <div>
            <label htmlFor="seat-slot" className="block text-xs font-medium text-slate-600 mb-1">
              Time Slot
            </label>
            <div className="relative">
              <Clock className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
              <select
                id="seat-slot"
                value={selectedSlot}
                onChange={(e) => {
                  setSelectedSlot(e.target.value);
                  setSelectedSeat(null);
                }}
                className="rounded-lg border border-slate-300 bg-white pl-9 pr-8 py-2 text-sm font-mono tabular-nums focus:border-[#2563EB] focus:outline-none"
              >
                {LIBRARY_TIME_SLOTS.map((slot) => (
                  <option key={slot} value={slot}>
                    {slot}
                  </option>
                ))}
              </select>
            </div>
          </div>
        </div>
      </div>

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

      {/* Occupancy Summary Bar */}
      <div className="flex flex-wrap items-center justify-between gap-4 rounded-xl border border-slate-200 bg-white px-5 py-3.5 text-xs">
        <div className="flex flex-wrap items-center gap-5">
          <span className="font-semibold text-[#0F1E36] tabular-nums">
            {availableCount} of {seats.length} seats open for {selectedSlot}
          </span>
          <span className="inline-flex items-center gap-1.5 text-slate-600">
            <span className="h-3 w-3 rounded border border-emerald-500 bg-emerald-50 inline-block" />
            Available
          </span>
          <span className="inline-flex items-center gap-1.5 text-slate-600">
            <span className="h-3 w-3 rounded border border-[#2563EB] bg-blue-50 inline-block" />
            Reserved by You
          </span>
          <span className="inline-flex items-center gap-1.5 text-slate-600">
            <span className="h-3 w-3 rounded border border-slate-300 bg-slate-200 inline-block" />
            Occupied
          </span>
        </div>

        {selectedSeat && userRole === 'STUDENT' && (
          <div className="flex items-center gap-3">
            <span className="text-sm font-medium text-[#0F1E36]">
              Selected: <span className="font-mono font-bold">{selectedSeat.seatCode}</span>
            </span>
            <button
              type="button"
              disabled={busy}
              onClick={handleBookSeat}
              className="rounded-lg bg-[#2563EB] px-4 py-2 text-xs font-semibold text-white hover:bg-blue-700 disabled:opacity-60 transition-colors whitespace-nowrap"
            >
              {busy ? 'Confirming...' : `Reserve Seat ${selectedSeat.seatCode}`}
            </button>
          </div>
        )}
      </div>

      {/* Floor Map Grids */}
      {loading ? (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <div className="h-56 animate-pulse rounded-xl border border-slate-200 bg-white" />
          <div className="h-56 animate-pulse rounded-xl border border-slate-200 bg-white" />
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {[
            { title: 'Floor 1 · Quiet Reading Wing', list: floor1Seats },
            { title: 'Floor 2 · Collaborative Commons', list: floor2Seats },
          ].map((wing) => (
            <section key={wing.title} className="rounded-xl border border-slate-200 bg-white p-5 space-y-4">
              <div className="flex items-center justify-between">
                <h3 className="font-display text-base font-bold text-[#0F1E36]">{wing.title}</h3>
                <span className="text-xs text-slate-500 tabular-nums">
                  {wing.list.filter((s) => s.isAvailableForSlot).length} / {wing.list.length} open
                </span>
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                {wing.list.map((seat) => {
                  const isSelected = selectedSeat?.id === seat.id;
                  const disabled = !seat.isAvailableForSlot || userRole !== 'STUDENT';

                  let stateStyle =
                    'border-emerald-200 bg-emerald-50/60 text-slate-900 hover:border-emerald-500 cursor-pointer';
                  if (seat.bookedByCurrentUser) {
                    stateStyle = 'border-[#2563EB] bg-blue-50 text-[#0F1E36] cursor-default';
                  } else if (!seat.isAvailableForSlot) {
                    stateStyle = 'border-slate-200 bg-slate-100 text-slate-500 cursor-not-allowed';
                  } else if (isSelected) {
                    stateStyle = 'border-[#2563EB] bg-blue-100/80 ring-2 ring-blue-600/25 text-[#0F1E36]';
                  } else if (userRole !== 'STUDENT') {
                    stateStyle = 'border-emerald-200 bg-emerald-50/40 text-slate-800 cursor-default';
                  }

                  return (
                    <button
                      key={seat.id}
                      type="button"
                      disabled={disabled && !seat.bookedByCurrentUser}
                      onClick={() => {
                        if (seat.isAvailableForSlot && userRole === 'STUDENT') {
                          setSelectedSeat(isSelected ? null : seat);
                        }
                      }}
                      aria-label={`Seat ${seat.seatCode}, ${
                        seat.bookedByCurrentUser
                          ? 'Reserved by you'
                          : seat.isAvailableForSlot
                            ? 'Available'
                            : `Occupied by ${seat.bookedByName}`
                      }`}
                      className={`rounded-lg border p-3 text-left transition-all ${stateStyle}`}
                    >
                      <div className="flex items-center justify-between">
                        <span className="font-mono text-sm font-bold tabular-nums">{seat.seatCode}</span>
                        <Armchair className="w-4 h-4 opacity-75" />
                      </div>
                      <p className="mt-1.5 text-[11px] font-medium truncate">
                        {seat.bookedByCurrentUser
                          ? 'Your Seat'
                          : seat.isAvailableForSlot
                            ? 'Available'
                            : seat.bookedByName || 'Occupied'}
                      </p>
                      <div className="mt-1.5 flex items-center gap-1.5 text-[10px] text-slate-500">
                        {seat.hasPowerOutlet && <PlugZap className="w-3 h-3" aria-label="Power outlet" />}
                        {seat.isQuietZone && <VolumeX className="w-3 h-3" aria-label="Quiet zone" />}
                      </div>
                    </button>
                  );
                })}
              </div>
            </section>
          ))}
        </div>
      )}

      {/* Active Reservations Table */}
      <section className="rounded-xl border border-slate-200 bg-white overflow-hidden">
        <div className="border-b border-slate-200 px-5 py-4 flex items-center justify-between">
          <h3 className="font-display text-base font-bold text-[#0F1E36]">
            {userRole === 'LIBRARIAN' ? 'All Active Seat Bookings' : 'My Seat Reservations'}
          </h3>
          <span className="text-xs text-slate-500 tabular-nums">{activeBookings.length} active</span>
        </div>

        {activeBookings.length === 0 ? (
          <div className="p-8 text-center text-sm text-slate-500">
            No active seat reservations. Select an available desk above to reserve a study slot.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="bg-slate-50 text-xs font-semibold text-slate-600 border-b border-slate-200">
                <tr>
                  <th className="px-5 py-3">Seat</th>
                  <th className="px-5 py-3">Location</th>
                  {userRole === 'LIBRARIAN' && <th className="px-5 py-3">Student</th>}
                  <th className="px-5 py-3">Date</th>
                  <th className="px-5 py-3">Time Slot</th>
                  <th className="px-5 py-3 text-right">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {activeBookings.map((b) => (
                  <tr key={b.id} className="hover:bg-slate-50/70">
                    <td className="px-5 py-3 font-mono font-semibold text-[#0F1E36]">{b.seatCode}</td>
                    <td className="px-5 py-3 text-slate-600">
                      {b.floor} · {b.zone}
                    </td>
                    {userRole === 'LIBRARIAN' && (
                      <td className="px-5 py-3 text-slate-800">
                        {b.studentName} <span className="font-mono text-xs text-slate-500">({b.enrollmentNumber})</span>
                      </td>
                    )}
                    <td className="px-5 py-3 font-mono text-xs tabular-nums text-slate-700">{b.bookingDate}</td>
                    <td className="px-5 py-3 font-mono text-xs tabular-nums text-slate-700">{b.timeSlot}</td>
                    <td className="px-5 py-3 text-right">
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => handleCancelBooking(b.id, b.seatCode)}
                        className="inline-flex items-center gap-1.5 rounded-md border border-red-200 bg-white px-3 py-1.5 text-xs font-medium text-red-700 hover:bg-red-50 transition-colors"
                      >
                        <XCircle className="w-3.5 h-3.5" />
                        Cancel Reservation
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
