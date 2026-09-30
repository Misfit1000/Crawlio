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

const ACCOUNT_ACTION_MESSAGES = {
  user_already_exists: 'An account already uses this email. Sign in instead of registering again.',
  email_exists: 'An account already uses this email. Sign in instead of registering again.',
  email_not_confirmed: 'Confirm your email using the link in your inbox, then sign in.',
  user_banned: 'This account is unavailable. Contact support if you believe this is a mistake.',
  invalid_credentials: 'Email or password is incorrect',
  weak_password: 'Choose a stronger password with at least 8 characters.',
  email_address_invalid: 'Enter a valid email address.',
  over_email_send_rate_limit: 'Confirmation emails are temporarily limited by the account service. Check your inbox and spam folder for an earlier confirmation link. If you already have an account, sign in instead of registering again.',
  over_request_rate_limit: 'The account service is temporarily limiting requests. Check your inbox and spam folder for an earlier confirmation link, or sign in if you already have an account. If you still need to register, try again later.',
};

function providerActionCode(error: unknown): keyof typeof ACCOUNT_ACTION_MESSAGES | 'unknown' {
  const code = typeof error === 'object' && error !== null && 'code' in error ? error.code : undefined;
  if (typeof code === 'string' && Object.prototype.hasOwnProperty.call(ACCOUNT_ACTION_MESSAGES, code)) return code as keyof typeof ACCOUNT_ACTION_MESSAGES;
  if (typeof error === 'object' && error !== null && 'status' in error && error.status === 429) return 'over_request_rate_limit';
  return 'unknown';
}

export function accountActionError(error: unknown, action: 'register' | 'login') {
  if (error instanceof AccountProfileError || error instanceof AccountActionError) return error.message;
  const code = providerActionCode(error);
  if (code !== 'unknown') return ACCOUNT_ACTION_MESSAGES[code];
  return action === 'register'
    ? 'Account creation could not be confirmed. Check your email or try signing in before registering again.'
    : 'Unable to sign in. Check your connection and try again.';
}

export class AccountActionError extends Error {
  readonly code: keyof typeof ACCOUNT_ACTION_MESSAGES | AccountProfileError['code'] | 'unknown';

  constructor(error: unknown, action: 'register' | 'login') {
    super(accountActionError(error, action));
    this.name = 'AccountActionError';
    this.code = error instanceof AccountProfileError || error instanceof AccountActionError
      ? error.code
      : providerActionCode(error);
  }
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
