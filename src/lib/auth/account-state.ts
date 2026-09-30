export type RegistrationOutcome =
  | { status: 'confirmation_required' }
  | { status: 'signed_in' }
  | { status: 'profile_pending'; message: string };

export class AccountProfileError extends Error {
  readonly code: 'session_expired' | 'access_denied' | 'profile_unavailable';

  constructor(status?: number) {
    const code = status === 401 ? 'session_expired' : status === 403 ? 'access_denied' : 'profile_unavailable';
    super(code === 'session_expired'
      ? 'Your session has expired. Sign in again to finish setting up your account.'
      : code === 'access_denied'
        ? 'This account is unavailable. Contact support if you believe this is a mistake.'
        : 'You are authenticated, but your account profile could not be loaded. Retry account setup; you do not need to create another account.');
    this.name = 'AccountProfileError';
    this.code = code;
  }

  get retryable() {
    return this.code === 'profile_unavailable';
  }
}

export function accountActionError(error: unknown, action: 'register' | 'login') {
  if (error instanceof AccountProfileError) return error.message;
  const code = typeof error === 'object' && error !== null && 'code' in error ? String(error.code) : '';
  if (code === 'user_already_exists' || code === 'email_exists') return 'An account already uses this email. Sign in instead of registering again.';
  if (code === 'email_not_confirmed') return 'Confirm your email using the link in your inbox, then sign in.';
  if (code === 'user_banned') return 'This account is unavailable. Contact support if you believe this is a mistake.';
  if (code === 'invalid_credentials') return 'Email or password is incorrect';
  if (code === 'weak_password') return 'Choose a stronger password with at least 8 characters.';
  if (code === 'email_address_invalid') return 'Enter a valid email address.';
  if (code === 'over_email_send_rate_limit' || code === 'over_request_rate_limit') return 'Too many attempts. Wait a few minutes before trying again.';
  return action === 'register'
    ? 'Account creation could not be confirmed. Check your email or try signing in before registering again.'
    : 'Unable to sign in. Check your connection and try again.';
}

export async function finishRegistration(
  hasSession: boolean,
  initializeProfile: () => Promise<unknown>,
): Promise<RegistrationOutcome> {
  if (!hasSession) return { status: 'confirmation_required' };
  try {
    await initializeProfile();
    return { status: 'signed_in' };
  } catch (error) {
    const failure = error instanceof AccountProfileError ? error : new AccountProfileError();
    if (!failure.retryable) throw failure;
    return { status: 'profile_pending', message: failure.message };
  }
}
