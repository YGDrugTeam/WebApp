import { render, screen } from '@testing-library/react';

jest.mock('axios', () => ({
  __esModule: true,
  ...(() => {
    const mock = {
      get: jest.fn().mockResolvedValue({ data: { azure: { configured: false } } }),
      post: jest.fn()
    };
    return { default: mock, ...mock };
  })()
}));

import App from './App';

test('renders app title', () => {
  render(<App />);
  expect(screen.getByText(/pill-safe ai/i)).toBeInTheDocument();
});
