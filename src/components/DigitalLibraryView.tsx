import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Bookmark,
  BookOpenText,
  ChevronLeft,
  ChevronRight,
  Download,
  FileText,
  Plus,
  Search,
  Trash2,
  X,
} from 'lucide-react';
import { DigitalCatalogEngine } from '../domain/LibraryOOP';
import type {
  Category,
  DigitalChapter,
  DigitalResource,
  DigitalResourceType,
  UserRole,
} from '../domain/types';
import { api } from '../services/api';

interface DigitalLibraryViewProps {
  userRole: UserRole;
  categories: Category[];
  onNotify?: (type: 'success' | 'error', message: string) => void;
  onDataChanged?: () => Promise<void>;
}

const TYPE_LABELS: Record<DigitalResourceType, string> = {
  EBOOK: 'E-Book',
  RESEARCH_PAPER: 'Research Paper',
  JOURNAL: 'Academic Journal',
  LECTURE_NOTES: 'Lecture Notes',
};

const TYPE_FILTERS: Array<{ id: DigitalResourceType | 'ALL'; label: string }> = [
  { id: 'ALL', label: 'All Resources' },
  { id: 'EBOOK', label: 'E-Books' },
  { id: 'RESEARCH_PAPER', label: 'Research Papers' },
  { id: 'JOURNAL', label: 'Journals' },
  { id: 'LECTURE_NOTES', label: 'Lecture Notes' },
];

export function DigitalLibraryView({
  userRole,
  categories,
  onNotify,
  onDataChanged,
}: DigitalLibraryViewProps) {
  const [resources, setResources] = useState<DigitalResource[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [typeFilter, setTypeFilter] = useState<DigitalResourceType | 'ALL'>('ALL');
  const [bookmarkedOnly, setBookmarkedOnly] = useState(false);

  // Built-in Online Reader state
  const [activeReader, setActiveReader] = useState<DigitalResource | null>(null);
  const [chapterIndex, setChapterIndex] = useState(0);
  const [fontSize, setFontSize] = useState<'sm' | 'md' | 'lg'>('md');

  // Librarian Publish Resource Modal state
  const [publishOpen, setPublishOpen] = useState(false);
  const [pTitle, setPTitle] = useState('');
  const [pAuthor, setPAuthor] = useState('');
  const [pCategoryId, setPCategoryId] = useState<number>(categories[0]?.id ?? 1);
  const [pType, setPType] = useState<DigitalResourceType>('EBOOK');
  const [pFormat, setPFormat] = useState<'PDF' | 'EPUB'>('PDF');
  const [pYear, setPYear] = useState(2026);
  const [pPages, setPPages] = useState(48);
  const [pSummary, setPSummary] = useState('');
  const [pChapter1Title, setPChapter1Title] = useState('1. Introduction & Core Theory');
  const [pChapter1Body, setPChapter1Body] = useState('');
  const [pChapter2Title, setPChapter2Title] = useState('2. Applied Examples & Summary');
  const [pChapter2Body, setPChapter2Body] = useState('');
  const [publishing, setPublishing] = useState(false);

  const loadResources = useCallback(async () => {
    try {
      const res = await api.getDigitalResources();
      setResources(res.resources);
    } catch (err) {
      onNotify?.('error', err instanceof Error ? err.message : 'Unable to load digital repository.');
    } finally {
      setLoading(false);
    }
  }, [onNotify]);

  useEffect(() => {
    loadResources();
  }, [loadResources]);

  useEffect(() => {
    if (categories.length > 0 && !categories.some((c) => c.id === pCategoryId)) {
      setPCategoryId(categories[0].id);
    }
  }, [categories, pCategoryId]);

  const filteredResources = useMemo(
    () => DigitalCatalogEngine.filterResources(resources, searchQuery, typeFilter, bookmarkedOnly),
    [resources, searchQuery, typeFilter, bookmarkedOnly]
  );

  const totalBookmarks = useMemo(
    () => resources.filter((r) => r.isBookmarked).length,
    [resources]
  );

  const handleOpenReader = async (resource: DigitalResource) => {
    const startChapter = Math.max(
      0,
      Math.min(Math.max(0, resource.chapters.length - 1), resource.lastChapter || 0)
    );
    setActiveReader(resource);
    setChapterIndex(startChapter);
    try {
      const updated = await api.recordDigitalRead(resource.id, startChapter, true);
      setResources((prev) =>
        prev.map((r) =>
          r.id === resource.id
            ? { ...r, readCount: updated.readCount, lastChapter: updated.lastChapter }
            : r
        )
      );
      setActiveReader((curr) =>
        curr && curr.id === resource.id
          ? { ...curr, readCount: updated.readCount, lastChapter: updated.lastChapter }
          : curr
      );
      if (onDataChanged) await onDataChanged();
    } catch {
      // Non-blocking read counter update
    }
  };

  const handleChangeChapter = async (nextIdx: number) => {
    if (!activeReader) return;
    setChapterIndex(nextIdx);
    try {
      const updated = await api.recordDigitalRead(activeReader.id, nextIdx, false);
      setResources((prev) =>
        prev.map((r) =>
          r.id === activeReader.id ? { ...r, lastChapter: updated.lastChapter } : r
        )
      );
    } catch {
      // Non-blocking chapter persistence
    }
  };

  const handleToggleBookmark = async (resource: DigitalResource) => {
    try {
      const res = await api.toggleDigitalBookmark(resource.id);
      setResources((prev) =>
        prev.map((r) => (r.id === resource.id ? { ...r, isBookmarked: res.isBookmarked } : r))
      );
      if (activeReader?.id === resource.id) {
        setActiveReader((prev) => (prev ? { ...prev, isBookmarked: res.isBookmarked } : null));
      }
      onNotify?.(
        'success',
        res.isBookmarked
          ? `Bookmarked "${resource.title}".`
          : `Removed bookmark for "${resource.title}".`
      );
    } catch (err) {
      onNotify?.('error', err instanceof Error ? err.message : 'Unable to update bookmark.');
    }
  };

  const handleDownloadStudyCopy = async (resource: DigitalResource) => {
    try {
      const textContent = DigitalCatalogEngine.buildDownloadableText(resource);
      const blob = new Blob([textContent], { type: 'text/plain;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `${resource.title.toLowerCase().replace(/[^a-z0-9]+/g, '-')}.txt`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);

      const res = await api.recordDigitalDownload(resource.id);
      setResources((prev) =>
        prev.map((r) => (r.id === resource.id ? { ...r, downloadCount: res.downloadCount } : r))
      );
      onNotify?.('success', `Downloaded study copy of "${resource.title}".`);
    } catch (err) {
      onNotify?.('error', err instanceof Error ? err.message : 'Download failed.');
    }
  };

  const handlePublishResource = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!pTitle.trim() || !pAuthor.trim() || !pSummary.trim()) {
      onNotify?.('error', 'Title, author, and summary are required.');
      return;
    }

    const chapters: DigitalChapter[] = [];
    if (pChapter1Body.trim()) {
      chapters.push({
        title: pChapter1Title.trim() || '1. Introduction',
        body: pChapter1Body.trim(),
      });
    }
    if (pChapter2Body.trim()) {
      chapters.push({
        title: pChapter2Title.trim() || '2. Key Takeaways',
        body: pChapter2Body.trim(),
      });
    }
    if (chapters.length === 0) {
      chapters.push({
        title: '1. Abstract & Executive Overview',
        body: pSummary.trim(),
      });
    }

    const publishedTitle = pTitle.trim();
    setPublishing(true);
    try {
      await api.createDigitalResource({
        title: publishedTitle,
        author: pAuthor.trim(),
        categoryId: Number(pCategoryId) || categories[0]?.id || 1,
        resourceType: pType,
        publicationYear: Number(pYear) || 2026,
        pageCount: Math.max(1, Number(pPages) || 24),
        fileFormat: pFormat,
        summary: pSummary.trim(),
        chapters,
      });
      setPublishOpen(false);
      setPTitle('');
      setPAuthor('');
      setPSummary('');
      setPChapter1Body('');
      setPChapter2Body('');
      await loadResources();
      if (onDataChanged) await onDataChanged();
      onNotify?.('success', `Published "${publishedTitle}" to the Digital Library.`);
    } catch (err) {
      onNotify?.('error', err instanceof Error ? err.message : 'Unable to publish resource.');
    } finally {
      setPublishing(false);
    }
  };

  const handleDeleteResource = async (resource: DigitalResource) => {
    try {
      await api.deleteDigitalResource(resource.id);
      await loadResources();
      if (onDataChanged) await onDataChanged();
      onNotify?.('success', `Removed "${resource.title}" from Digital Library.`);
    } catch (err) {
      onNotify?.('error', err instanceof Error ? err.message : 'Unable to delete digital resource.');
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h2 className="font-display text-xl font-bold text-[#0F1E36]">
            Digital Library & Open Academic Repository
          </h2>
          <p className="text-sm text-slate-600 mt-1">
            Read peer-reviewed papers, e-books, journals, and lecture notes online, bookmark chapters, or download offline study copies.
          </p>
        </div>

        {userRole === 'LIBRARIAN' && (
          <button
            type="button"
            onClick={() => setPublishOpen(true)}
            className="inline-flex items-center gap-2 rounded-lg bg-[#2563EB] px-4 py-2 text-xs font-semibold text-white hover:bg-blue-700 transition-colors whitespace-nowrap"
          >
            <Plus className="w-4 h-4" />
            Publish Digital Resource
          </button>
        )}
      </div>

      {/* Search and Segmented Filter Bar */}
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
        <div className="relative flex-1 max-w-lg">
          <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
          <label htmlFor="digital-search" className="sr-only">
            Search digital library resources
          </label>
          <input
            id="digital-search"
            type="search"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search e-books, papers, authors, or topics..."
            className="w-full rounded-lg border border-slate-300 bg-white pl-10 pr-4 py-2.5 text-sm focus:border-[#2563EB] focus:outline-none focus:ring-2 focus:ring-blue-600/20"
          />
        </div>

        <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="Filter digital resources">
          {TYPE_FILTERS.map((tf) => (
            <button
              key={tf.id}
              type="button"
              onClick={() => setTypeFilter(tf.id)}
              className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors whitespace-nowrap ${
                typeFilter === tf.id
                  ? 'bg-[#0F1E36] text-white'
                  : 'border border-slate-200 bg-white text-slate-600 hover:bg-slate-100'
              }`}
            >
              {tf.label}
            </button>
          ))}

          {userRole === 'STUDENT' && (
            <button
              type="button"
              onClick={() => setBookmarkedOnly((v) => !v)}
              aria-pressed={bookmarkedOnly}
              className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors whitespace-nowrap ${
                bookmarkedOnly
                  ? 'bg-[#2563EB] text-white'
                  : 'border border-slate-200 bg-white text-slate-700 hover:bg-slate-100'
              }`}
            >
              <Bookmark className="w-3.5 h-3.5" />
              Bookmarked ({totalBookmarks})
            </button>
          )}
        </div>
      </div>

      {/* Resource Cards */}
      {loading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {[1, 2, 3, 4].map((n) => (
            <div key={n} className="h-44 animate-pulse rounded-xl border border-slate-200 bg-white" />
          ))}
        </div>
      ) : filteredResources.length === 0 ? (
        <div className="rounded-xl border border-slate-200 bg-white p-12 text-center space-y-2">
          <p className="font-display text-base font-bold text-[#0F1E36]">
            No digital resources match your filter
          </p>
          <p className="text-sm text-slate-500">
            Clear your search or switch back to All Resources.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {filteredResources.map((res) => (
            <article
              key={res.id}
              className="rounded-xl border border-slate-200 bg-white p-5 flex flex-col justify-between gap-4"
            >
              <div className="space-y-2">
                <div className="flex items-start justify-between gap-3">
                  <p className="text-xs font-semibold text-[#2563EB]">
                    {TYPE_LABELS[res.resourceType]} · {res.categoryName}
                  </p>
                  <div className="flex items-center gap-1.5 shrink-0">
                    {userRole === 'STUDENT' && (
                      <button
                        type="button"
                        onClick={() => handleToggleBookmark(res)}
                        aria-label={
                          res.isBookmarked ? `Remove bookmark for ${res.title}` : `Bookmark ${res.title}`
                        }
                        className={`rounded-md border p-1.5 transition-colors ${
                          res.isBookmarked
                            ? 'border-blue-200 bg-blue-50 text-[#2563EB]'
                            : 'border-slate-200 text-slate-500 hover:bg-slate-50'
                        }`}
                      >
                        <Bookmark className={`w-4 h-4 ${res.isBookmarked ? 'fill-current' : ''}`} />
                      </button>
                    )}
                    {userRole === 'LIBRARIAN' && (
                      <button
                        type="button"
                        onClick={() => handleDeleteResource(res)}
                        aria-label={`Delete ${res.title}`}
                        className="rounded-md border border-red-200 p-1.5 text-red-600 hover:bg-red-50 transition-colors"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    )}
                  </div>
                </div>

                <h3 className="font-display text-base font-bold text-[#0F1E36] leading-snug">
                  {res.title}
                </h3>
                <p className="text-xs text-slate-600">{res.author}</p>
                <p className="text-xs text-slate-600 line-clamp-2 leading-relaxed">{res.summary}</p>
              </div>

              <div className="border-t border-slate-100 pt-3 flex flex-wrap items-center justify-between gap-3">
                <p className="text-[11px] font-mono text-slate-500 tabular-nums">
                  {res.fileFormat} · {res.pageCount} pp · {res.publicationYear} · {res.readCount} reads · {res.downloadCount} downloads
                </p>

                <div className="flex items-center gap-2 shrink-0">
                  <button
                    type="button"
                    onClick={() => handleDownloadStudyCopy(res)}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 transition-colors whitespace-nowrap"
                  >
                    <Download className="w-3.5 h-3.5" />
                    Download
                  </button>
                  <button
                    type="button"
                    onClick={() => handleOpenReader(res)}
                    className="inline-flex items-center gap-1.5 rounded-lg bg-[#0F1E36] px-3 py-1.5 text-xs font-semibold text-white hover:bg-[#162B4D] transition-colors whitespace-nowrap"
                  >
                    <BookOpenText className="w-3.5 h-3.5" />
                    Read Online
                  </button>
                </div>
              </div>
            </article>
          ))}
        </div>
      )}

      {/* Built-in Multi-Chapter Online Reader Modal */}
      {activeReader && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="digital-reader-title"
        >
          <div className="w-full max-w-4xl max-h-[90vh] rounded-xl border border-slate-200 bg-white shadow-2xl flex flex-col overflow-hidden">
            <div className="flex items-center justify-between gap-4 border-b border-slate-200 px-6 py-4 bg-[#0F1E36] text-white">
              <div className="min-w-0">
                <p className="text-xs font-mono text-blue-200 truncate">
                  {TYPE_LABELS[activeReader.resourceType]} · {activeReader.fileFormat} · {activeReader.author}
                </p>
                <h2 id="digital-reader-title" className="font-display text-lg font-bold truncate">
                  {activeReader.title}
                </h2>
              </div>

              <div className="flex items-center gap-2 shrink-0">
                <div className="hidden sm:flex items-center rounded-lg border border-white/20 overflow-hidden text-xs">
                  {(['sm', 'md', 'lg'] as const).map((sz) => (
                    <button
                      key={sz}
                      type="button"
                      onClick={() => setFontSize(sz)}
                      className={`px-2.5 py-1 font-mono uppercase ${
                        fontSize === sz ? 'bg-[#2563EB] text-white' : 'text-slate-200 hover:bg-white/10'
                      }`}
                    >
                      {sz}
                    </button>
                  ))}
                </div>
                {userRole === 'STUDENT' && (
                  <button
                    type="button"
                    onClick={() => handleToggleBookmark(activeReader)}
                    aria-pressed={activeReader.isBookmarked}
                    aria-label={
                      activeReader.isBookmarked
                        ? 'Bookmarked current resource'
                        : 'Bookmark current resource'
                    }
                    className={`rounded-lg border px-3 py-1.5 text-xs font-semibold inline-flex items-center gap-1.5 ${
                      activeReader.isBookmarked
                        ? 'border-blue-400 bg-[#2563EB] text-white'
                        : 'border-white/20 text-slate-100 hover:bg-white/10'
                    }`}
                  >
                    <Bookmark className={`w-3.5 h-3.5 ${activeReader.isBookmarked ? 'fill-current' : ''}`} />
                    {activeReader.isBookmarked ? 'Bookmarked' : 'Bookmark'}
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => setActiveReader(null)}
                  aria-label="Close online reader"
                  className="rounded-lg p-1.5 text-slate-200 hover:bg-white/10"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>
            </div>

            <div className="flex-1 overflow-y-auto grid grid-cols-1 md:grid-cols-12">
              {/* Chapter Sidebar */}
              <aside className="md:col-span-4 border-b md:border-b-0 md:border-r border-slate-200 bg-slate-50 p-4 space-y-2">
                <p className="text-xs font-bold text-slate-500 uppercase tracking-wider px-2">
                  Chapters ({activeReader.chapters.length})
                </p>
                {activeReader.chapters.map((ch, idx) => (
                  <button
                    key={`${idx}-${ch.title}`}
                    type="button"
                    onClick={() => handleChangeChapter(idx)}
                    className={`w-full text-left rounded-lg px-3 py-2 text-xs font-medium transition-colors ${
                      chapterIndex === idx
                        ? 'bg-[#0F1E36] text-white'
                        : 'text-slate-700 hover:bg-slate-200/70'
                    }`}
                  >
                    {ch.title}
                  </button>
                ))}
              </aside>

              {/* Reader Canvas */}
              <div className="md:col-span-8 p-6 sm:p-8 space-y-5 bg-white">
                {activeReader.chapters[chapterIndex] ? (
                  <>
                    <div className="border-b border-slate-100 pb-3">
                      <p className="text-xs font-mono text-[#2563EB] tabular-nums">
                        Section {chapterIndex + 1} of {activeReader.chapters.length}
                      </p>
                      <h3 className="font-display text-xl font-bold text-[#0F1E36] mt-1">
                        {activeReader.chapters[chapterIndex].title}
                      </h3>
                    </div>

                    <div
                      className={`text-slate-800 leading-relaxed space-y-4 ${
                        fontSize === 'sm' ? 'text-sm' : fontSize === 'lg' ? 'text-lg' : 'text-base'
                      }`}
                    >
                      <p>{activeReader.chapters[chapterIndex].body}</p>
                      <p className="text-xs text-slate-500 border-t border-slate-100 pt-4">
                        Abstract context: {activeReader.summary}
                      </p>
                    </div>
                  </>
                ) : (
                  <p className="text-sm text-slate-500">No sections available.</p>
                )}
              </div>
            </div>

            <div className="flex items-center justify-between border-t border-slate-200 px-6 py-3.5 bg-slate-50">
              <button
                type="button"
                disabled={chapterIndex <= 0}
                onClick={() => handleChangeChapter(chapterIndex - 1)}
                className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-100 disabled:opacity-40"
              >
                <ChevronLeft className="w-4 h-4" />
                Previous Section
              </button>
              <span className="text-xs font-mono text-slate-600 tabular-nums">
                Section {chapterIndex + 1} / {Math.max(1, activeReader.chapters.length)}
              </span>
              <button
                type="button"
                disabled={chapterIndex >= activeReader.chapters.length - 1}
                onClick={() => handleChangeChapter(chapterIndex + 1)}
                className="inline-flex items-center gap-1.5 rounded-lg bg-[#2563EB] px-3 py-1.5 text-xs font-semibold text-white hover:bg-blue-700 disabled:opacity-40"
              >
                Next Section
                <ChevronRight className="w-4 h-4" />
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Librarian Publish Digital Resource Modal */}
      {publishOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/50 p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="publish-digital-title"
        >
          <div className="w-full max-w-xl max-h-[90vh] overflow-y-auto rounded-xl border border-slate-200 bg-white shadow-xl">
            <div className="flex items-center justify-between border-b border-slate-200 px-6 py-4 bg-slate-50">
              <div className="flex items-center gap-2">
                <FileText className="w-5 h-5 text-[#2563EB]" />
                <h2 id="publish-digital-title" className="font-display text-lg font-bold text-[#0F1E36]">
                  Publish Digital Resource
                </h2>
              </div>
              <button
                type="button"
                onClick={() => setPublishOpen(false)}
                aria-label="Close publish modal"
                className="rounded-lg p-1.5 text-slate-500 hover:bg-slate-200"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handlePublishResource} className="p-6 space-y-4">
              <div>
                <label htmlFor="dr-title" className="block text-xs font-medium text-slate-700 mb-1">
                  Resource Title
                </label>
                <input
                  id="dr-title"
                  type="text"
                  required
                  value={pTitle}
                  onChange={(e) => setPTitle(e.target.value)}
                  placeholder="e.g., Compiler Construction & JVM Bytecode"
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-[#2563EB] focus:outline-none"
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label htmlFor="dr-author" className="block text-xs font-medium text-slate-700 mb-1">
                    Author / Faculty
                  </label>
                  <input
                    id="dr-author"
                    type="text"
                    required
                    value={pAuthor}
                    onChange={(e) => setPAuthor(e.target.value)}
                    placeholder="Dr. Kavita Rao"
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-[#2563EB] focus:outline-none"
                  />
                </div>
                <div>
                  <label htmlFor="dr-cat" className="block text-xs font-medium text-slate-700 mb-1">
                    Category
                  </label>
                  <select
                    id="dr-cat"
                    value={pCategoryId}
                    onChange={(e) => setPCategoryId(Number(e.target.value))}
                    className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm focus:border-[#2563EB] focus:outline-none"
                  >
                    {categories.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <div>
                  <label htmlFor="dr-type" className="block text-xs font-medium text-slate-700 mb-1">
                    Resource Type
                  </label>
                  <select
                    id="dr-type"
                    value={pType}
                    onChange={(e) => setPType(e.target.value as DigitalResourceType)}
                    className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm focus:border-[#2563EB] focus:outline-none"
                  >
                    <option value="EBOOK">E-Book</option>
                    <option value="RESEARCH_PAPER">Research Paper</option>
                    <option value="JOURNAL">Academic Journal</option>
                    <option value="LECTURE_NOTES">Lecture Notes</option>
                  </select>
                </div>
                <div>
                  <label htmlFor="dr-format" className="block text-xs font-medium text-slate-700 mb-1">
                    Format
                  </label>
                  <select
                    id="dr-format"
                    value={pFormat}
                    onChange={(e) => setPFormat(e.target.value as 'PDF' | 'EPUB')}
                    className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm focus:border-[#2563EB] focus:outline-none"
                  >
                    <option value="PDF">PDF</option>
                    <option value="EPUB">EPUB</option>
                  </select>
                </div>
                <div>
                  <label htmlFor="dr-year" className="block text-xs font-medium text-slate-700 mb-1">
                    Year
                  </label>
                  <input
                    id="dr-year"
                    type="number"
                    value={pYear}
                    onChange={(e) => setPYear(Number(e.target.value))}
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm font-mono focus:border-[#2563EB] focus:outline-none"
                  />
                </div>
                <div>
                  <label htmlFor="dr-pages" className="block text-xs font-medium text-slate-700 mb-1">
                    Pages
                  </label>
                  <input
                    id="dr-pages"
                    type="number"
                    min={1}
                    value={pPages}
                    onChange={(e) => setPPages(Number(e.target.value))}
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm font-mono focus:border-[#2563EB] focus:outline-none"
                  />
                </div>
              </div>

              <div>
                <label htmlFor="dr-summary" className="block text-xs font-medium text-slate-700 mb-1">
                  Abstract / Summary
                </label>
                <textarea
                  id="dr-summary"
                  rows={2}
                  required
                  value={pSummary}
                  onChange={(e) => setPSummary(e.target.value)}
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-[#2563EB] focus:outline-none"
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 border-t border-slate-100 pt-3">
                <div className="space-y-2">
                  <label htmlFor="dr-ch1-title" className="block text-xs font-medium text-slate-700">
                    Section 1 Heading
                  </label>
                  <input
                    id="dr-ch1-title"
                    type="text"
                    value={pChapter1Title}
                    onChange={(e) => setPChapter1Title(e.target.value)}
                    className="w-full rounded-lg border border-slate-300 px-3 py-1.5 text-xs focus:border-[#2563EB] focus:outline-none"
                  />
                  <textarea
                    id="dr-ch1-body"
                    rows={3}
                    value={pChapter1Body}
                    onChange={(e) => setPChapter1Body(e.target.value)}
                    placeholder="Section 1 reader content..."
                    className="w-full rounded-lg border border-slate-300 px-3 py-1.5 text-xs focus:border-[#2563EB] focus:outline-none"
                  />
                </div>
                <div className="space-y-2">
                  <label htmlFor="dr-ch2-title" className="block text-xs font-medium text-slate-700">
                    Section 2 Heading (Optional)
                  </label>
                  <input
                    id="dr-ch2-title"
                    type="text"
                    value={pChapter2Title}
                    onChange={(e) => setPChapter2Title(e.target.value)}
                    className="w-full rounded-lg border border-slate-300 px-3 py-1.5 text-xs focus:border-[#2563EB] focus:outline-none"
                  />
                  <textarea
                    id="dr-ch2-body"
                    rows={3}
                    value={pChapter2Body}
                    onChange={(e) => setPChapter2Body(e.target.value)}
                    placeholder="Section 2 reader content..."
                    className="w-full rounded-lg border border-slate-300 px-3 py-1.5 text-xs focus:border-[#2563EB] focus:outline-none"
                  />
                </div>
              </div>

              <div className="flex justify-end gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => setPublishOpen(false)}
                  className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={publishing}
                  className="rounded-lg bg-[#2563EB] px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-60"
                >
                  {publishing ? 'Publishing...' : 'Publish Resource'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
