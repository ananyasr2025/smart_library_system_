import { useEffect, useState } from 'react';
import { BookOpen } from 'lucide-react';

interface BookCoverProps {
  src?: string;
  title: string;
  category: string;
  className?: string;
}

export function BookCover({ src, title, category, className = 'w-16 h-22' }: BookCoverProps) {
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    setFailed(false);
  }, [src]);

  if (!src || failed) {
    return (
      <div
        className={`flex flex-col justify-between rounded-md border border-slate-200 bg-gradient-to-br from-[#0F1E36] to-[#1E3A66] p-2 text-white shrink-0 ${className}`}
      >
        <BookOpen className="w-4 h-4 text-blue-200" aria-hidden="true" />
        <div className="overflow-hidden">
          <p className="text-[10px] font-semibold leading-tight line-clamp-2">{title}</p>
          <p className="text-[9px] text-blue-200 truncate mt-0.5">{category}</p>
        </div>
      </div>
    );
  }

  return (
    <img
      src={src}
      alt={`Cover of ${title}`}
      referrerPolicy="no-referrer"
      onError={() => setFailed(true)}
      className={`rounded-md border border-slate-200 object-cover shrink-0 bg-slate-100 ${className}`}
    />
  );
}
