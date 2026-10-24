import React, { useRef, useState } from 'react';
import {
  createUserWithEmailAndPassword,
  sendEmailVerification,
  sendPasswordResetEmail,
  signInWithEmailAndPassword,
  signInWithPopup,
  updateProfile,
} from 'firebase/auth';
import {
  ArrowRight,
  Camera,
  CheckCircle2,
  Clock,
  ExternalLink,
  KeyRound,
  LogOut,
  MailCheck,
  RefreshCw,
  ShieldCheck,
  XCircle,
} from 'lucide-react';
import {
  auth,
  googleProvider,
  FIREBASE_PROJECT_ID,
  BOOTSTRAPPED_ADMIN_EMAIL,
} from '../lib/firebase';
import { apiRequest, formatDateTime, uploadCompressedMedia } from '../lib/api';
import { useAuth } from '../context/AuthContext';
import { AvatarDisplay, primeMediaCache } from './MediaView';
import { PWAInstallButton } from './PWAInstallPrompt';
import { BD_MOBILE_PATTERN, MAX_NAME_LENGTH } from '../types';

type AuthMode = 'login' | 'register' | 'recover';

let pendingDraftRegistration: { fullName: string; phone: string } | null = null;

function mapFirebaseAuthError(err: unknown): { message: string; needsEmailProviderSetup?: boolean } {
  const code = (err as { code?: string })?.code || '';
  const msg = err instanceof Error ? err.message : String(err);

  if (code === 'auth/operation-not-allowed' || msg.includes('operation-not-allowed')) {
    return {
      message:
        'Email/Password sign-in is not enabled yet in Firebase Console. Enable Email/Password in Firebase Authentication -> Sign-in method, or sign in immediately with Google below.',
      needsEmailProviderSetup: true,
    };
  }
  if (code === 'auth/invalid-credential' || code === 'auth/wrong-password' || code === 'auth/user-not-found') {
    return { message: 'Incorrect email or password. Please verify your credentials.' };
  }
  if (code === 'auth/email-already-in-use') {
    return { message: 'An account with this email already exists. Switch to Sign In.' };
  }
  if (code === 'auth/weak-password') {
    return { message: 'Password must be at least 6 characters long.' };
  }
  if (code === 'auth/popup-closed-by-user') {
    return { message: 'Google sign-in popup was closed before completing.' };
  }
  if (code === 'auth/too-many-requests') {
    return { message: 'Too many attempts. Please wait a moment and try again.' };
  }
  return { message: msg || 'Authentication failed. Please try again.' };
}

export const OFFICIAL_MTS_LOGO_SRC = '/assets/aistudio/IMG-20261025-WA0003_2e02a657.jpg';

export function BrandLogoMark({ className = 'w-10 h-10 rounded-full' }: { className?: string }) {
  const [imgFailed, setImgFailed] = useState(false);

  if (imgFailed) {
    return (
      <span
        className={`${className} bg-gradient-to-br from-teal-400 to-emerald-600 text-slate-950 font-bold tracking-tight inline-flex items-center justify-center shrink-0`}
      >
        MTS
      </span>
    );
  }

  return (
    <span
      className={`${className} bg-white p-0.5 ring-1 ring-white/25 overflow-hidden inline-flex items-center justify-center shrink-0 shadow-sm`}
    >
      <img
        src={OFFICIAL_MTS_LOGO_SRC}
        alt="MTS Freelancing Zone official logo"
        referrerPolicy="no-referrer"
        onError={() => setImgFailed(true)}
        className="w-full h-full object-contain rounded-full"
      />
    </span>
  );
}

export function BrandWordmark({ size = 'md' }: { size?: 'sm' | 'md' | 'lg' }) {
  const logoSize =
    size === 'sm'
      ? 'w-9 h-9 rounded-full text-xs'
      : size === 'lg'
      ? 'w-16 h-16 sm:w-20 sm:h-20 rounded-2xl text-base'
      : 'w-11 h-11 rounded-full text-sm';
  const textSize = size === 'sm' ? 'text-base' : size === 'lg' ? 'text-xl sm:text-2xl' : 'text-lg';
  return (
    <div className="flex items-center gap-3 shrink-0">
      <BrandLogoMark className={logoSize} />
      <span className={`${textSize} font-bold tracking-tight text-white whitespace-nowrap`}>
        MTS Freelancing Zone
      </span>
    </div>
  );
}

export function AuthPortal() {
  const [mode, setMode] = useState<AuthMode>('login');
  const [fullName, setFullName] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [needsEmailSetup, setNeedsEmailSetup] = useState(false);
  const [infoMessage, setInfoMessage] = useState<string | null>(null);

  const handleGoogleAuth = async () => {
    setError(null);
    setInfoMessage(null);
    setNeedsEmailSetup(false);
    setSubmitting(true);
    try {
      const cred = await signInWithPopup(auth, googleProvider);
      if (cred.user.emailVerified) {
        // Attempt idempotent profile lookup/bootstrap; if brand new member without phone, CompleteRegistrationScreen lets them confirm details
        if (mode === 'register' && fullName.trim().length >= 2) {
          await apiRequest('/api/auth/register', {
            method: 'POST',
            body: {
              fullName: fullName.trim().slice(0, MAX_NAME_LENGTH),
              phone: phone.trim(),
              authProvider: 'google.com',
            },
          });
        }
      }
    } catch (err) {
      const mapped = mapFirebaseAuthError(err);
      setError(mapped.message);
      setNeedsEmailSetup(Boolean(mapped.needsEmailProviderSetup));
    } finally {
      setSubmitting(false);
    }
  };

  const handleFormSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setInfoMessage(null);
    setNeedsEmailSetup(false);

    const trimmedEmail = email.trim().toLowerCase();
    if (!trimmedEmail) {
      setError('Enter your email address.');
      return;
    }

    if (mode === 'recover') {
      setSubmitting(true);
      try {
        await sendPasswordResetEmail(auth, trimmedEmail);
        setInfoMessage('Password recovery link sent. Check your inbox and spam folder.');
      } catch (err) {
        const mapped = mapFirebaseAuthError(err);
        setError(mapped.message);
        setNeedsEmailSetup(Boolean(mapped.needsEmailProviderSetup));
      } finally {
        setSubmitting(false);
      }
      return;
    }

    if (mode === 'register') {
      const cleanName = fullName.trim();
      const cleanPhone = phone.trim();
      if (cleanName.length < 2) {
        setError('Enter your full name (at least 2 characters).');
        return;
      }
      if (cleanPhone && !BD_MOBILE_PATTERN.test(cleanPhone)) {
        setError('Enter a valid Bangladeshi phone number (e.g., 01712345678).');
        return;
      }
      if (password.length < 6) {
        setError('Password must be at least 6 characters.');
        return;
      }

      setSubmitting(true);
      try {
        pendingDraftRegistration = { fullName: cleanName, phone: cleanPhone };
        const cred = await createUserWithEmailAndPassword(auth, trimmedEmail, password);
        await updateProfile(cred.user, { displayName: cleanName });
        if (!cred.user.emailVerified) {
          await sendEmailVerification(cred.user);
        } else {
          await apiRequest('/api/auth/register', {
            method: 'POST',
            body: {
              fullName: cleanName,
              phone: cleanPhone,
              authProvider: 'password',
            },
          });
        }
      } catch (err) {
        const mapped = mapFirebaseAuthError(err);
        setError(mapped.message);
        setNeedsEmailSetup(Boolean(mapped.needsEmailProviderSetup));
      } finally {
        setSubmitting(false);
      }
      return;
    }

    // Login
    setSubmitting(true);
    try {
      await signInWithEmailAndPassword(auth, trimmedEmail, password);
    } catch (err) {
      const mapped = mapFirebaseAuthError(err);
      setError(mapped.message);
      setNeedsEmailSetup(Boolean(mapped.needsEmailProviderSetup));
    } finally {
      setSubmitting(false);
    }
  };

  const consoleAuthUrl = `https://console.firebase.google.com/project/${FIREBASE_PROJECT_ID}/authentication/providers`;

  return (
    <div className="min-h-dvh flex flex-col justify-center px-4 py-8 sm:px-6 lg:px-10">
      <div className="max-w-5xl w-full mx-auto grid grid-cols-1 lg:grid-cols-12 gap-8 items-stretch">
        {/* Left Brand & Fintech Highlights */}
        <div className="lg:col-span-6 flex flex-col justify-between rounded-3xl bg-gradient-to-br from-[#0F1E42] via-[#0B1530] to-[#081024] border border-teal-400/20 p-6 sm:p-8">
          <div>
            <BrandWordmark size="lg" />
            <h1
              className="mt-6 text-2xl sm:text-3xl lg:text-4xl font-bold text-white leading-tight tracking-tight"
              style={{ textWrap: 'balance' }}
            >
              Verified Micro-Task Earnings & Instant Mobile Payouts
            </h1>
            <p className="mt-3 text-sm sm:text-base text-sky-200/75 leading-relaxed max-w-xl">
              Complete verified digital tasks, upload screenshot proof, track real-time Bangladeshi Taka
              balances, and withdraw securely to bKash or Nagad.
            </p>
          </div>

          <div className="mt-8 pt-6 border-t border-white/10 space-y-4">
            <div className="flex items-start gap-3">
              <ShieldCheck className="w-5 h-5 text-teal-400 shrink-0 mt-0.5" />
              <div>
                <p className="text-sm font-semibold text-white">Admin-Verified Member Access</p>
                <p className="text-xs text-sky-200/70 mt-0.5">
                  Every new member registration is reviewed by an authorized Admin to protect task quality.
                </p>
              </div>
            </div>
            <div className="flex items-start gap-3">
              <CheckCircle2 className="w-5 h-5 text-emerald-400 shrink-0 mt-0.5" />
              <div>
                <p className="text-sm font-semibold text-white">Minimum Withdraw 100 Tk · Fixed ৳5 Fee</p>
                <p className="text-xs text-sky-200/70 mt-0.5">
                  Clear pre-confirmation breakdown on every bKash and Nagad payout request starting from ৳100.
                </p>
              </div>
            </div>
            <div className="pt-2">
              <PWAInstallButton />
            </div>
          </div>
        </div>

        {/* Right Interactive Auth Form */}
        <div className="lg:col-span-6 rounded-3xl bg-[#0D1730]/95 border border-white/10 p-6 sm:p-8 flex flex-col justify-center">
          {/* Segmented Mode Control */}
          <div className="grid grid-cols-3 gap-1 p-1 rounded-xl bg-[#070D1D] border border-white/10">
            <button
              type="button"
              onClick={() => {
                setMode('login');
                setError(null);
                setInfoMessage(null);
              }}
              className={`min-h-[44px] px-3 rounded-lg text-xs sm:text-sm font-semibold transition-colors whitespace-nowrap shrink-0 ${
                mode === 'login'
                  ? 'bg-teal-500 text-slate-950'
                  : 'text-sky-200/75 hover:text-white'
              }`}
            >
              Sign In
            </button>
            <button
              type="button"
              onClick={() => {
                setMode('register');
                setError(null);
                setInfoMessage(null);
              }}
              className={`min-h-[44px] px-3 rounded-lg text-xs sm:text-sm font-semibold transition-colors whitespace-nowrap shrink-0 ${
                mode === 'register'
                  ? 'bg-teal-500 text-slate-950'
                  : 'text-sky-200/75 hover:text-white'
              }`}
            >
              Register
            </button>
            <button
              type="button"
              onClick={() => {
                setMode('recover');
                setError(null);
                setInfoMessage(null);
              }}
              className={`min-h-[44px] px-3 rounded-lg text-xs sm:text-sm font-semibold transition-colors whitespace-nowrap shrink-0 ${
                mode === 'recover'
                  ? 'bg-teal-500 text-slate-950'
                  : 'text-sky-200/75 hover:text-white'
              }`}
            >
              Recovery
            </button>
          </div>

          <div className="mt-6">
            <h2 className="text-xl font-bold text-white">
              {mode === 'login'
                ? 'Sign in to your account'
                : mode === 'register'
                ? 'Apply for Member access'
                : 'Recover your account'}
            </h2>
            <p className="text-xs sm:text-sm text-sky-200/70 mt-1">
              {mode === 'login'
                ? 'Access your tasks, proof history, and BDT wallet.'
                : mode === 'register'
                ? 'New accounts start in Pending status until Admin approval.'
                : 'Send a secure password reset link to your registered email.'}
            </p>
          </div>

          {error && (
            <div className="mt-4 p-3.5 rounded-xl bg-rose-500/10 border border-rose-400/30 text-xs sm:text-sm text-rose-200 space-y-2">
              <p>{error}</p>
              {needsEmailSetup && (
                <a
                  href={consoleAuthUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1.5 text-teal-300 hover:text-teal-200 font-semibold underline"
                >
                  <span>Open Firebase Auth Providers Console</span>
                  <ExternalLink className="w-3.5 h-3.5" />
                </a>
              )}
            </div>
          )}

          {infoMessage && (
            <div className="mt-4 p-3.5 rounded-xl bg-emerald-500/10 border border-emerald-400/30 text-xs sm:text-sm text-emerald-200">
              {infoMessage}
            </div>
          )}

          <form onSubmit={handleFormSubmit} className="mt-5 space-y-4">
            {mode === 'register' && (
              <>
                <div>
                  <label className="block text-xs font-medium text-sky-200/80 mb-1.5">
                    Full Name
                  </label>
                  <input
                    type="text"
                    required
                    maxLength={MAX_NAME_LENGTH}
                    value={fullName}
                    onChange={(e) => setFullName(e.target.value)}
                    placeholder="e.g., Tanvir Ahmed"
                    className="w-full min-h-[46px] px-3.5 rounded-xl bg-[#070E20] border border-white/15 text-sm text-white placeholder:text-sky-200/35 focus:outline-none focus:border-teal-400"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-sky-200/80 mb-1.5">
                    Mobile Number (bKash / Nagad compatible)
                  </label>
                  <input
                    type="tel"
                    maxLength={15}
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                    placeholder="01712345678"
                    className="w-full min-h-[46px] px-3.5 rounded-xl bg-[#070E20] border border-white/15 text-sm font-mono tabular-nums text-white placeholder:text-sky-200/35 focus:outline-none focus:border-teal-400"
                  />
                </div>
              </>
            )}

            <div>
              <label className="block text-xs font-medium text-sky-200/80 mb-1.5">
                Email Address
              </label>
              <input
                type="email"
                required
                maxLength={150}
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@example.com"
                className="w-full min-h-[46px] px-3.5 rounded-xl bg-[#070E20] border border-white/15 text-sm text-white placeholder:text-sky-200/35 focus:outline-none focus:border-teal-400"
              />
            </div>

            {mode !== 'recover' && (
              <div>
                <label className="block text-xs font-medium text-sky-200/80 mb-1.5">
                  Password
                </label>
                <input
                  type="password"
                  required
                  minLength={6}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Minimum 6 characters"
                  className="w-full min-h-[46px] px-3.5 rounded-xl bg-[#070E20] border border-white/15 text-sm text-white placeholder:text-sky-200/35 focus:outline-none focus:border-teal-400"
                />
              </div>
            )}

            <button
              type="submit"
              disabled={submitting}
              className="w-full min-h-[48px] px-4 rounded-xl bg-teal-500 hover:bg-teal-400 disabled:opacity-60 text-slate-950 font-semibold text-sm flex items-center justify-center gap-2 transition-colors whitespace-nowrap"
            >
              <span>
                {submitting
                  ? 'Please wait...'
                  : mode === 'login'
                  ? 'Sign In'
                  : mode === 'register'
                  ? 'Submit Registration'
                  : 'Send Recovery Link'}
              </span>
              {!submitting && <ArrowRight className="w-4 h-4" />}
            </button>
          </form>

          {mode !== 'recover' && (
            <>
              <div className="my-5 flex items-center gap-3">
                <div className="h-px flex-1 bg-white/10" />
                <span className="text-xs text-sky-200/50">or instant verified login</span>
                <div className="h-px flex-1 bg-white/10" />
              </div>

              <button
                type="button"
                disabled={submitting}
                onClick={handleGoogleAuth}
                className="w-full min-h-[48px] px-4 rounded-xl bg-white/8 hover:bg-white/12 border border-white/15 text-white font-medium text-sm flex items-center justify-center gap-2.5 transition-colors whitespace-nowrap"
              >
                <KeyRound className="w-4 h-4 text-teal-300" />
                <span>Continue with Google</span>
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

export function EmailVerificationScreen() {
  const { firebaseUser, refreshUserState, logout } = useAuth();
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const handleResend = async () => {
    if (!firebaseUser) return;
    setBusy(true);
    setNotice(null);
    try {
      await sendEmailVerification(firebaseUser);
      setNotice('Verification link sent. Check your inbox and spam folder.');
    } catch (err) {
      setNotice(err instanceof Error ? err.message : 'Could not resend email right now.');
    } finally {
      setBusy(false);
    }
  };

  const handleCheckVerified = async () => {
    setBusy(true);
    setNotice(null);
    try {
      await refreshUserState();
      if (!auth.currentUser?.emailVerified) {
        setNotice('Email is not marked verified yet. Click the link in your email first.');
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="min-h-dvh flex items-center justify-center p-4">
      <div className="max-w-md w-full rounded-3xl bg-[#0D1730] border border-teal-400/25 p-6 sm:p-8 space-y-5">
        <div className="flex items-center justify-between gap-4">
          <BrandWordmark size="sm" />
          <div className="w-10 h-10 rounded-xl bg-teal-500/15 border border-teal-400/30 flex items-center justify-center text-teal-300 shrink-0">
            <MailCheck className="w-5 h-5" />
          </div>
        </div>
        <div>
          <h1 className="text-xl font-bold text-white">Verify Your Email Address</h1>
          <p className="text-sm text-sky-200/75 mt-1.5 leading-relaxed">
            We sent a verification link to{' '}
            <span className="text-white font-medium">{firebaseUser?.email}</span>. Verify your email
            to submit your MTS Freelancing Zone registration for Admin approval.
          </p>
        </div>

        {notice && (
          <div className="p-3.5 rounded-xl bg-white/5 border border-white/10 text-xs text-sky-100">
            {notice}
          </div>
        )}

        <div className="space-y-3">
          <button
            type="button"
            disabled={busy}
            onClick={handleCheckVerified}
            className="w-full min-h-[48px] px-4 rounded-xl bg-teal-500 hover:bg-teal-400 text-slate-950 font-semibold text-sm flex items-center justify-center gap-2 transition-colors whitespace-nowrap"
          >
            <RefreshCw className={`w-4 h-4 ${busy ? 'animate-spin' : ''}`} />
            <span>I Verified My Email — Continue</span>
          </button>

          <button
            type="button"
            disabled={busy}
            onClick={handleResend}
            className="w-full min-h-[44px] px-4 rounded-xl bg-white/6 hover:bg-white/10 border border-white/10 text-sm text-white font-medium transition-colors whitespace-nowrap"
          >
            Resend Verification Email
          </button>

          <button
            type="button"
            onClick={logout}
            className="w-full min-h-[44px] px-4 rounded-xl text-xs text-sky-200/70 hover:text-white flex items-center justify-center gap-1.5"
          >
            <LogOut className="w-3.5 h-3.5" />
            <span>Sign out</span>
          </button>
        </div>
      </div>
    </div>
  );
}

export function CompleteRegistrationScreen() {
  const { firebaseUser, logout } = useAuth();
  const [fullName, setFullName] = useState(
    () => pendingDraftRegistration?.fullName || firebaseUser?.displayName || ''
  );
  const [phone, setPhone] = useState(() => pendingDraftRegistration?.phone || '');
  const [photoFile, setPhotoFile] = useState<File | null>(null);
  const [photoPreview, setPhotoPreview] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const regPhotoRef = useRef<HTMLInputElement>(null);

  const handlePickPhoto = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (photoPreview) URL.revokeObjectURL(photoPreview);
    setPhotoFile(file);
    setPhotoPreview(URL.createObjectURL(file));
    setError(null);
  };

  const handleComplete = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    const cleanName = fullName.trim();
    const cleanPhone = phone.trim();

    if (cleanName.length < 2) {
      setError('Full name must be at least 2 characters.');
      return;
    }
    if (cleanPhone && !BD_MOBILE_PATTERN.test(cleanPhone)) {
      setError('Enter a valid Bangladeshi mobile number (e.g., 01712345678).');
      return;
    }

    setSubmitting(true);
    try {
      const provider =
        firebaseUser?.providerData[0]?.providerId === 'google.com' ? 'google.com' : 'password';
      const safeName = cleanName.slice(0, MAX_NAME_LENGTH);
      await apiRequest('/api/auth/register', {
        method: 'POST',
        body: {
          fullName: safeName,
          phone: cleanPhone,
          authProvider: provider,
        },
      });

      if (photoFile) {
        const uploaded = await uploadCompressedMedia(photoFile, 'avatar');
        primeMediaCache(uploaded.assetId, uploaded.previewDataUrl);
        await apiRequest('/api/profile', {
          method: 'PUT',
          body: {
            fullName: safeName,
            phone: cleanPhone,
            photoAssetId: uploaded.assetId,
          },
        });
      }

      pendingDraftRegistration = null;
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Registration failed.');
    } finally {
      setSubmitting(false);
    }
  };

  const isOwnerAdmin =
    firebaseUser?.email?.toLowerCase() === BOOTSTRAPPED_ADMIN_EMAIL;

  return (
    <div className="min-h-dvh flex items-center justify-center p-4">
      <div className="max-w-md w-full rounded-3xl bg-[#0D1730] border border-white/12 p-6 sm:p-8 space-y-5">
        <BrandWordmark />
        <div>
          <h1 className="text-xl font-bold text-white">
            {isOwnerAdmin ? 'Activate Administrator Account' : 'Complete Member Registration'}
          </h1>
          <p className="text-sm text-sky-200/75 mt-1">
            {isOwnerAdmin ? (
              <>
                Confirm your administrator profile details for{' '}
                <span className="text-white">{firebaseUser?.email}</span> to open the Admin Control
                Panel immediately.
              </>
            ) : (
              <>
                Confirm your profile details and upload your photo for{' '}
                <span className="text-white">{firebaseUser?.email}</span>. Your account will be
                placed in Pending status for Admin approval.
              </>
            )}
          </p>
        </div>

        {error && (
          <div className="p-3.5 rounded-xl bg-rose-500/10 border border-rose-400/30 text-xs text-rose-200">
            {error}
          </div>
        )}

        <form onSubmit={handleComplete} className="space-y-4">
          <div className="flex items-center gap-4 p-3.5 rounded-2xl bg-[#070E20] border border-white/12">
            <AvatarDisplay
              fullName={fullName || 'Member'}
              sizeClass="w-16 h-16 text-base"
              previewOverride={photoPreview}
            />
            <div className="space-y-1.5">
              <p className="text-xs font-semibold text-white">Member Profile Photo</p>
              <input
                ref={regPhotoRef}
                type="file"
                accept="image/png,image/jpeg,image/webp"
                onChange={handlePickPhoto}
                className="hidden"
              />
              <button
                type="button"
                onClick={() => regPhotoRef.current?.click()}
                className="min-h-[40px] px-3.5 rounded-xl bg-teal-500/20 hover:bg-teal-500/30 border border-teal-400/30 text-xs font-semibold text-teal-200 inline-flex items-center gap-1.5"
              >
                <Camera className="w-3.5 h-3.5" />
                <span>{photoPreview ? 'Change Photo' : 'Upload Photo'}</span>
              </button>
            </div>
          </div>

          <div>
            <label className="block text-xs font-medium text-sky-200/80 mb-1.5">Full Name</label>
            <input
              type="text"
              required
              maxLength={MAX_NAME_LENGTH}
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
              placeholder="Your full legal name"
              className="w-full min-h-[46px] px-3.5 rounded-xl bg-[#070E20] border border-white/15 text-sm text-white focus:outline-none focus:border-teal-400"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-sky-200/80 mb-1.5">
              Mobile Number (bKash / Nagad)
            </label>
            <input
              type="tel"
              maxLength={15}
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder="01712345678"
              className="w-full min-h-[46px] px-3.5 rounded-xl bg-[#070E20] border border-white/15 text-sm font-mono tabular-nums text-white focus:outline-none focus:border-teal-400"
            />
          </div>
          <button
            type="submit"
            disabled={submitting}
            className="w-full min-h-[48px] px-4 rounded-xl bg-teal-500 hover:bg-teal-400 disabled:opacity-60 text-slate-950 font-semibold text-sm transition-colors whitespace-nowrap"
          >
            {submitting
              ? 'Saving Registration...'
              : isOwnerAdmin
              ? 'Activate Admin Account'
              : 'Submit for Admin Approval'}
          </button>
        </form>

        <button
          type="button"
          onClick={logout}
          className="w-full min-h-[44px] text-xs text-sky-200/70 hover:text-white flex items-center justify-center gap-1.5"
        >
          <LogOut className="w-3.5 h-3.5" />
          <span>Sign out</span>
        </button>
      </div>
    </div>
  );
}

export function AccountApprovalGate() {
  const { profile, logout } = useAuth();
  const [uploadingPhoto, setUploadingPhoto] = useState(false);
  const [photoNotice, setPhotoNotice] = useState<{ type: 'error' | 'success'; text: string } | null>(null);
  const gatePhotoInputRef = useRef<HTMLInputElement>(null);

  if (!profile) return null;

  const isRejected = profile.status === 'rejected';

  const handleGatePhotoUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploadingPhoto(true);
    setPhotoNotice(null);
    try {
      const uploaded = await uploadCompressedMedia(file, 'avatar');
      primeMediaCache(uploaded.assetId, uploaded.previewDataUrl);
      await apiRequest('/api/profile', {
        method: 'PUT',
        body: {
          fullName: profile.fullName,
          phone: profile.phone || '',
          photoAssetId: uploaded.assetId,
        },
      });
      setPhotoNotice({ type: 'success', text: 'Profile photo uploaded and visible to Admin.' });
    } catch (err) {
      setPhotoNotice({
        type: 'error',
        text: err instanceof Error ? err.message : 'Could not upload profile photo.',
      });
    } finally {
      setUploadingPhoto(false);
      e.target.value = '';
    }
  };

  return (
    <div className="min-h-dvh flex items-center justify-center p-4">
      <div className="max-w-lg w-full rounded-3xl bg-[#0D1730] border border-white/12 p-6 sm:p-8 space-y-6">
        <div className="flex items-center justify-between gap-4">
          <BrandWordmark size="sm" />
          <div className="flex items-center gap-1.5 text-xs font-medium">
            {isRejected ? (
              <>
                <XCircle className="w-4 h-4 text-rose-400 shrink-0" />
                <span className="text-rose-300">Registration Rejected</span>
              </>
            ) : (
              <>
                <Clock className="w-4 h-4 text-amber-400 shrink-0" />
                <span className="text-amber-300">Pending Approval</span>
              </>
            )}
          </div>
        </div>

        <div>
          <h1 className="text-xl sm:text-2xl font-bold text-white">
            {isRejected
              ? 'Your Membership Application Was Declined'
              : 'Waiting for Administrator Approval'}
          </h1>
          <p className="text-sm text-sky-200/75 mt-2 leading-relaxed">
            {isRejected
              ? 'An administrator reviewed your registration and declined access to protected member pages.'
              : 'Your registration has been securely recorded. Make sure your profile photo is uploaded below so the Admin can verify your identity quickly.'}
          </p>
        </div>

        {/* Member Photo Preview & Upload on Approval Gate */}
        <div className="flex items-center gap-4 p-4 rounded-2xl bg-[#070E20] border border-white/10">
          <AvatarDisplay
            photoAssetId={profile.photoAssetId}
            fullName={profile.fullName}
            sizeClass="w-16 h-16 text-base"
            zoomable
          />
          <div className="space-y-1.5 min-w-0">
            <p className="text-sm font-semibold text-white truncate">{profile.fullName}</p>
            <input
              ref={gatePhotoInputRef}
              type="file"
              accept="image/png,image/jpeg,image/webp"
              onChange={handleGatePhotoUpload}
              className="hidden"
            />
            <button
              type="button"
              disabled={uploadingPhoto}
              onClick={() => gatePhotoInputRef.current?.click()}
              className="min-h-[40px] px-3.5 rounded-xl bg-teal-500/20 hover:bg-teal-500/30 border border-teal-400/30 text-xs font-semibold text-teal-200 inline-flex items-center gap-1.5"
            >
              <Camera className="w-3.5 h-3.5" />
              <span>
                {uploadingPhoto
                  ? 'Uploading Photo...'
                  : profile.photoAssetId
                  ? 'Change Profile Photo'
                  : 'Upload Profile Photo'}
              </span>
            </button>
          </div>
        </div>

        {photoNotice && (
          <div
            className={`p-3 rounded-xl border text-xs ${
              photoNotice.type === 'success'
                ? 'bg-emerald-500/12 border-emerald-400/30 text-emerald-200'
                : 'bg-rose-500/12 border-rose-400/30 text-rose-200'
            }`}
          >
            {photoNotice.text}
          </div>
        )}

        {isRejected && profile.rejectionReason && (
          <div className="p-4 rounded-2xl bg-rose-500/10 border border-rose-400/25 space-y-1">
            <p className="text-xs font-medium text-rose-300">Administrator Note</p>
            <p className="text-sm text-white">{profile.rejectionReason}</p>
          </div>
        )}

        <div className="divide-y divide-white/8 border-t border-b border-white/10 text-sm">
          <div className="py-3 flex items-center justify-between gap-4">
            <span className="text-sky-200/70">Member ID</span>
            <span className="font-mono tabular-nums font-semibold text-teal-300">
              {profile.memberId}
            </span>
          </div>
          <div className="py-3 flex items-center justify-between gap-4">
            <span className="text-sky-200/70">Full Name</span>
            <span className="text-white font-medium truncate">{profile.fullName}</span>
          </div>
          <div className="py-3 flex items-center justify-between gap-4">
            <span className="text-sky-200/70">Email</span>
            <span className="text-white truncate">{profile.email}</span>
          </div>
          {profile.phone && (
            <div className="py-3 flex items-center justify-between gap-4">
              <span className="text-sky-200/70">Mobile</span>
              <span className="font-mono tabular-nums text-white">{profile.phone}</span>
            </div>
          )}
          <div className="py-3 flex items-center justify-between gap-4">
            <span className="text-sky-200/70">Registered</span>
            <span className="font-mono tabular-nums text-xs text-sky-100">
              {formatDateTime(profile.createdAt)}
            </span>
          </div>
        </div>

        <button
          type="button"
          onClick={logout}
          className="w-full min-h-[48px] px-4 rounded-xl bg-white/8 hover:bg-white/12 border border-white/12 text-sm font-medium text-white flex items-center justify-center gap-2 transition-colors whitespace-nowrap"
        >
          <LogOut className="w-4 h-4 text-sky-200" />
          <span>Sign Out</span>
        </button>
      </div>
    </div>
  );
}
