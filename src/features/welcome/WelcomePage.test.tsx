import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { WelcomePage } from './WelcomePage';

it('links to registration and sign-in', () => {
  render(<MemoryRouter><WelcomePage /></MemoryRouter>);
  expect(screen.getByRole('heading', { level: 1 })).toBeInTheDocument();
  expect(screen.getByRole('link', { name: 'Create account' })).toHaveAttribute('href', '/register');
  expect(screen.getByRole('link', { name: 'Sign in' })).toHaveAttribute('href', '/login');
});
