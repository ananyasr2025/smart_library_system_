import { useState } from 'react';
import { BookMarked, GraduationCap, ShieldCheck } from 'lucide-react';
import type { UserProfile, UserRole } from '../domain/types';
import { api, setAuthToken } from '../services/api';

interface AuthPortalProps {
  onAuthenticated: (user: UserProfile) => void;
}

const AVAILABLE_INTERESTS = [
  'Software Engineering',
  'Algorithms',
  'Data Science',
  'Systems Architecture',
  'Mathematics',
  'Philosophy',
];

export function AuthPortal({ onAuthenticated }: AuthPortalProps) {
  const [portalRole, setPortalRole] = useState<UserRole>('STUDENT');
  const [mode, setMode] = useState<'LOGIN' | 'REGISTER'>('LOGIN');

  // Login state
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');

  // Registration state
  const [regName, setRegName] = useState('');
  const [regEmail, setRegEmail] = useState('');
  const [regPassword, setRegPassword] = useState('');
  const [regEnrollment, setRegEnrollment] = useState('');
  const [regDepartment, setRegDepartment] = useState('Computer Science');
  const [regSemester, setRegSemester] = useState(4);
  const [regInterests, setRegInterests] = useState<string[]>(['Software Engineering', 'Algorithms']);

  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const handlePortalChange = (role: UserRole) => {
    setPortalRole(role);
    setError(null);
    if (role === 'LIBRARIAN') {
      setMode('LOGIN');
    }
  };

  const handleLoginSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (!email.trim() || !password) {
      setError('Please enter both your academic email and password.');
      return;
    }

    setLoading(true);
    try {
      const res = await api.login(email.trim(), password, portalRole);
      setAuthToken(res.token);
      onAuthenticated(res.user);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to sign in.');
    } finally {
      setLoading(false);
    }
  };

  const handleRegisterSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (!regName.trim() || !regEmail.trim() || !regPassword || !regEnrollment.trim() || !regDepartment.trim()) {
      setError('All student registration fields are required.');
      return;
    }

    if (regPassword.length < 6) {
      setError('Password must be at least 6 characters.');
      return;
    }

    setLoading(true);
    try {
      const res = await api.register({
        name: regName.trim(),
        email: regEmail.trim(),
        password: regPassword,
        enrollmentNumber: regEnrollment.trim(),
        department: regDepartment.trim(),
        semester: regSemester,
        interests: regInterests.length > 0 ? regInterests : ['Software Engineering'],
      });
      setAuthToken(res.token);
      onAuthenticated(res.user);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Registration failed.');
    } finally {
      setLoading(false);
    }
  };

  const toggleInterest = (topic: string) => {
    setRegInterests((prev) =>
      prev.includes(topic) ? prev.filter((item) => item !== topic) : [...prev, topic]
    );
  };

  const fillDemoStudent = () => {
    setPortalRole('STUDENT');
    setMode('LOGIN');
    setEmail('arjun.mehta@university.edu');
    setPassword('student123');
    setError(null);
  };

  const fillDemoLibrarian = () => {
    setPortalRole('LIBRARIAN');
    setMode('LOGIN');
    setEmail('librarian@smartlibrary.edu');
    setPassword('admin123');
    setError(null);
  };

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col lg:flex-row">
      {/* Left Editorial Showcase Panel */}
      <div className="relative lg:w-5/12 xl:w-1/2 bg-[#0F1E36] text-white flex flex-col justify-between overflow-hidden min-h-[280px] lg:min-h-screen">
        <img
          src="/src/assets/images/library_atrium_hero_1795356527156.jpg"
          alt="University Smart Library Atrium"
          referrerPolicy="no-referrer"
          className="absolute inset-0 h-full w-full object-cover opacity-35"
        />
        <div
          className="absolute inset-0 bg-gradient-to-t from-[#091426] via-[#0F1E36]/80 to-[#0F1E36]/60"
          aria-hidden="true"
        />

        <div className="relative z-10 p-8 lg:p-12 flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-blue-500/20 border border-blue-400/30">
            <BookMarked className="w-5 h-5 text-blue-300" aria-hidden="true" />
          </div>
          <span className="font-display text-lg font-bold tracking-tight text-white">
            Smart Library Management System
          </span>
        </div>

        <div className="relative z-10 p-8 lg:p-12 space-y-6 max-w-xl">
          <h1 className="font-display text-3xl lg:text-4xl font-bold leading-tight text-balance">
            Academic circulation, seat booking, and collection intelligence in one system.
          </h1>
          <p className="text-sm lg:text-base text-slate-200 leading-relaxed">
            Built with Object-Oriented Java MVC architecture and relational SQL persistence for university students and librarians.
          </p>

          <div className="grid grid-cols-2 gap-4 pt-2 border-t border-white/15 text-xs text-slate-200">
            <div>
              <p className="font-semibold text-white">Student Services</p>
              <p className="mt-1 text-slate-300">QR self-checkout · Smart recommendations · Seat booking · Fine tracking</p>
            </div>
            <div>
              <p className="font-semibold text-white">Librarian Console</p>
              <p className="mt-1 text-slate-300">Catalog CRUD · Request approvals · Overdue ledger · Monthly analytics</p>
            </div>
          </div>
        </div>
      </div>

      {/* Right Authentication Form Panel */}
      <div className="flex-1 flex items-center justify-center p-6 sm:p-10 lg:p-14 bg-white">
        <div className="w-full max-w-md space-y-6">
          <div>
            <h2 className="font-display text-2xl font-bold text-[#0F1E36]">
              {mode === 'REGISTER' ? 'Create Student Account' : 'Sign In to Library Portal'}
            </h2>
            <p className="mt-1 text-sm text-slate-600">
              Select your portal role and enter your university credentials.
            </p>
          </div>

          {/* Portal Role Selector */}
          <div className="grid grid-cols-2 gap-1 rounded-lg bg-slate-100 p-1" role="tablist" aria-label="Portal Role">
            <button
              type="button"
              role="tab"
              aria-selected={portalRole === 'STUDENT'}
              onClick={() => handlePortalChange('STUDENT')}
              className={`flex items-center justify-center gap-2 rounded-md px-3 py-2 text-sm font-semibold transition-colors whitespace-nowrap ${
                portalRole === 'STUDENT'
                  ? 'bg-white text-[#0F1E36] shadow-xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              <GraduationCap className="w-4 h-4" />
              Student Portal
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={portalRole === 'LIBRARIAN'}
              onClick={() => handlePortalChange('LIBRARIAN')}
              className={`flex items-center justify-center gap-2 rounded-md px-3 py-2 text-sm font-semibold transition-colors whitespace-nowrap ${
                portalRole === 'LIBRARIAN'
                  ? 'bg-white text-[#0F1E36] shadow-xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              <ShieldCheck className="w-4 h-4" />
              Librarian Portal
            </button>
          </div>

          {portalRole === 'STUDENT' && (
            <div className="flex items-center gap-4 border-b border-slate-200 text-sm">
              <button
                type="button"
                onClick={() => {
                  setMode('LOGIN');
                  setError(null);
                }}
                className={`pb-2.5 font-semibold border-b-2 transition-colors ${
                  mode === 'LOGIN'
                    ? 'border-[#2563EB] text-[#2563EB]'
                    : 'border-transparent text-slate-500 hover:text-slate-800'
                }`}
              >
                Student Sign In
              </button>
              <button
                type="button"
                onClick={() => {
                  setMode('REGISTER');
                  setError(null);
                }}
                className={`pb-2.5 font-semibold border-b-2 transition-colors ${
                  mode === 'REGISTER'
                    ? 'border-[#2563EB] text-[#2563EB]'
                    : 'border-transparent text-slate-500 hover:text-slate-800'
                }`}
              >
                New Student Registration
              </button>
            </div>
          )}

          {error && (
            <div
              role="alert"
              className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800"
            >
              {error}
            </div>
          )}

          {mode === 'LOGIN' ? (
            <form onSubmit={handleLoginSubmit} className="space-y-4" noValidate>
              <div>
                <label htmlFor="login-email" className="block text-sm font-medium text-slate-700 mb-1">
                  Academic Email
                </label>
                <input
                  id="login-email"
                  type="email"
                  autoComplete="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder={
                    portalRole === 'LIBRARIAN'
                      ? 'librarian@smartlibrary.edu'
                      : 'arjun.mehta@university.edu'
                  }
                  className="w-full rounded-lg border border-slate-300 px-3.5 py-2.5 text-sm text-slate-900 focus:border-[#2563EB] focus:outline-none focus:ring-2 focus:ring-blue-600/20"
                />
              </div>

              <div>
                <label htmlFor="login-password" className="block text-sm font-medium text-slate-700 mb-1">
                  Password
                </label>
                <input
                  id="login-password"
                  type="password"
                  autoComplete="current-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Enter your password"
                  className="w-full rounded-lg border border-slate-300 px-3.5 py-2.5 text-sm text-slate-900 focus:border-[#2563EB] focus:outline-none focus:ring-2 focus:ring-blue-600/20"
                />
              </div>

              <button
                type="submit"
                disabled={loading}
                className="w-full rounded-lg bg-[#2563EB] px-4 py-2.5 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-60 transition-colors cursor-pointer"
              >
                {loading
                  ? 'Signing In...'
                  : portalRole === 'LIBRARIAN'
                    ? 'Sign In as Librarian'
                    : 'Sign In to Student Portal'}
              </button>

              {/* Sample Credentials Helper */}
              <div className="rounded-lg border border-slate-200 bg-slate-50 p-4 space-y-2.5">
                <p className="text-xs font-semibold text-slate-700">
                  Sample Academic Accounts (Click to Autofill)
                </p>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={fillDemoStudent}
                    className="rounded-md border border-slate-300 bg-white px-3 py-2 text-left text-xs hover:border-blue-400 hover:bg-blue-50/40 transition-colors"
                  >
                    <span className="block font-semibold text-[#0F1E36]">Student Demo</span>
                    <span className="block font-mono text-[11px] text-slate-600 truncate">
                      arjun.mehta@university.edu
                    </span>
                  </button>
                  <button
                    type="button"
                    onClick={fillDemoLibrarian}
                    className="rounded-md border border-slate-300 bg-white px-3 py-2 text-left text-xs hover:border-blue-400 hover:bg-blue-50/40 transition-colors"
                  >
                    <span className="block font-semibold text-[#0F1E36]">Librarian Demo</span>
                    <span className="block font-mono text-[11px] text-slate-600 truncate">
                      librarian@smartlibrary.edu
                    </span>
                  </button>
                </div>
              </div>
            </form>
          ) : (
            <form onSubmit={handleRegisterSubmit} className="space-y-3.5" noValidate>
              <div>
                <label htmlFor="reg-name" className="block text-xs font-medium text-slate-700 mb-1">
                  Full Name
                </label>
                <input
                  id="reg-name"
                  type="text"
                  value={regName}
                  onChange={(e) => setRegName(e.target.value)}
                  placeholder="e.g., Ananya Verma"
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-[#2563EB] focus:outline-none focus:ring-2 focus:ring-blue-600/20"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label htmlFor="reg-enroll" className="block text-xs font-medium text-slate-700 mb-1">
                    Enrollment ID
                  </label>
                  <input
                    id="reg-enroll"
                    type="text"
                    value={regEnrollment}
                    onChange={(e) => setRegEnrollment(e.target.value)}
                    placeholder="CS2026-088"
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm font-mono focus:border-[#2563EB] focus:outline-none"
                  />
                </div>
                <div>
                  <label htmlFor="reg-semester" className="block text-xs font-medium text-slate-700 mb-1">
                    Semester
                  </label>
                  <select
                    id="reg-semester"
                    value={regSemester}
                    onChange={(e) => setRegSemester(Number(e.target.value))}
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm bg-white focus:border-[#2563EB] focus:outline-none"
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
                <label htmlFor="reg-dept" className="block text-xs font-medium text-slate-700 mb-1">
                  Department
                </label>
                <input
                  id="reg-dept"
                  type="text"
                  value={regDepartment}
                  onChange={(e) => setRegDepartment(e.target.value)}
                  placeholder="Computer Science"
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-[#2563EB] focus:outline-none"
                />
              </div>

              <div>
                <label htmlFor="reg-email" className="block text-xs font-medium text-slate-700 mb-1">
                  University Email
                </label>
                <input
                  id="reg-email"
                  type="email"
                  value={regEmail}
                  onChange={(e) => setRegEmail(e.target.value)}
                  placeholder="student@university.edu"
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-[#2563EB] focus:outline-none"
                />
              </div>

              <div>
                <label htmlFor="reg-password" className="block text-xs font-medium text-slate-700 mb-1">
                  Password (min. 6 characters)
                </label>
                <input
                  id="reg-password"
                  type="password"
                  value={regPassword}
                  onChange={(e) => setRegPassword(e.target.value)}
                  placeholder="Create password"
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-[#2563EB] focus:outline-none"
                />
              </div>

              <div>
                <span className="block text-xs font-medium text-slate-700 mb-1.5">
                  Reading Interests (for Recommendations)
                </span>
                <div className="flex flex-wrap gap-1.5">
                  {AVAILABLE_INTERESTS.map((topic) => {
                    const selected = regInterests.includes(topic);
                    return (
                      <button
                        key={topic}
                        type="button"
                        onClick={() => toggleInterest(topic)}
                        className={`rounded-md border px-2.5 py-1 text-xs font-medium transition-colors ${
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

              <button
                type="submit"
                disabled={loading}
                className="w-full rounded-lg bg-[#0F1E36] px-4 py-2.5 text-sm font-semibold text-white hover:bg-[#162B4D] disabled:opacity-60 transition-colors cursor-pointer"
              >
                {loading ? 'Creating Account...' : 'Register Student Account'}
              </button>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}
