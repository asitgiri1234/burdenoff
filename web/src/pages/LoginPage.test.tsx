import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '../lib/errors.ts';
import { LoginPage } from './LoginPage.tsx';

const login = vi.fn();
const register = vi.fn();

vi.mock('../auth/useAuth.ts', () => ({
  useAuth: () => ({ user: null, loading: false, login, register, logout: vi.fn() }),
}));

beforeEach(() => {
  login.mockReset().mockResolvedValue(undefined);
  register.mockReset().mockResolvedValue(undefined);
});

describe('sign in', () => {
  it('submits the credentials', async () => {
    const user = userEvent.setup();
    render(<LoginPage />);

    await user.type(screen.getByLabelText('Email'), 'agent@example.com');
    await user.type(screen.getByLabelText('Password'), 'password123');
    await user.click(screen.getByRole('button', { name: 'Sign in' }));

    expect(login).toHaveBeenCalledWith('agent@example.com', 'password123');
  });

  it('shows a banner when the server rejects the credentials', async () => {
    login.mockRejectedValue(new ApiError('Invalid email or password', 'UNAUTHORIZED'));
    const user = userEvent.setup();
    render(<LoginPage />);

    await user.type(screen.getByLabelText('Email'), 'agent@example.com');
    await user.type(screen.getByLabelText('Password'), 'wrong');
    await user.click(screen.getByRole('button', { name: 'Sign in' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('You need to sign in to do that.');
  });
});

describe('create account', () => {
  async function openRegister(): Promise<ReturnType<typeof userEvent.setup>> {
    const user = userEvent.setup();
    render(<LoginPage />);
    await user.click(screen.getByRole('tab', { name: 'Create account' }));
    return user;
  }

  it('hides the agent signup code while the role is REPORTER', async () => {
    await openRegister();

    // Reporter signup is open, so no code field should be asked for.
    expect(screen.queryByLabelText('Agent signup code')).not.toBeInTheDocument();
  });

  it('reveals the agent signup code only once AGENT is chosen', async () => {
    const user = await openRegister();

    await user.selectOptions(screen.getByLabelText('Role'), 'AGENT');

    expect(await screen.findByLabelText('Agent signup code')).toBeInTheDocument();
    expect(screen.getByText('Required to register as an agent.')).toBeInTheDocument();
  });

  it('hides it again if the role is switched back', async () => {
    const user = await openRegister();

    await user.selectOptions(screen.getByLabelText('Role'), 'AGENT');
    expect(await screen.findByLabelText('Agent signup code')).toBeInTheDocument();

    await user.selectOptions(screen.getByLabelText('Role'), 'REPORTER');
    await waitFor(() => {
      expect(screen.queryByLabelText('Agent signup code')).not.toBeInTheDocument();
    });
  });

  it('passes the signup code through when registering as an agent', async () => {
    const user = await openRegister();

    await user.type(screen.getByLabelText('Name'), 'Ava Agent');
    await user.type(screen.getByLabelText('Email'), 'ava@example.com');
    await user.type(screen.getByLabelText('Password'), 'password123');
    await user.selectOptions(screen.getByLabelText('Role'), 'AGENT');
    await user.type(await screen.findByLabelText('Agent signup code'), 'let-me-in');
    await user.click(screen.getByRole('button', { name: 'Create account' }));

    expect(register).toHaveBeenCalledWith({
      name: 'Ava Agent',
      email: 'ava@example.com',
      password: 'password123',
      role: 'AGENT',
      agentSignupCode: 'let-me-in',
    });
  });

  it('places a server field error next to the offending input', async () => {
    register.mockRejectedValue(
      new ApiError('Invalid input', 'VALIDATION_ERROR', [
        { path: 'password', message: 'Password must be at least 8 characters' },
      ]),
    );
    const user = await openRegister();

    await user.type(screen.getByLabelText('Name'), 'Sam');
    await user.type(screen.getByLabelText('Email'), 'sam@example.com');
    await user.type(screen.getByLabelText('Password'), 'abcd');
    await user.click(screen.getByRole('button', { name: 'Create account' }));

    // Inline beside the field, plus the summary banner.
    expect(
      await screen.findByText('Password must be at least 8 characters'),
    ).toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveTextContent('Please correct the highlighted fields.');
  });

  it('surfaces FORBIDDEN when the agent code is wrong', async () => {
    register.mockRejectedValue(
      new ApiError('A valid agent signup code is required', 'FORBIDDEN'),
    );
    const user = await openRegister();

    await user.type(screen.getByLabelText('Name'), 'Sneaky');
    await user.type(screen.getByLabelText('Email'), 'sneaky@example.com');
    await user.type(screen.getByLabelText('Password'), 'password123');
    await user.selectOptions(screen.getByLabelText('Role'), 'AGENT');
    await user.type(await screen.findByLabelText('Agent signup code'), 'guess');
    await user.click(screen.getByRole('button', { name: 'Create account' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      "You don't have permission to do that.",
    );
  });
});
