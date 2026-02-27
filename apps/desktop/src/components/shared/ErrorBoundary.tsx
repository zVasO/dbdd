import { Component, type ReactNode } from 'react';

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false, error: null };

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="flex h-full items-center justify-center p-8">
          <div className="text-center">
            <h2 className="mb-2 text-lg font-semibold" style={{ color: 'var(--color-error)' }}>
              Something went wrong
            </h2>
            <p className="text-sm" style={{ color: 'var(--color-text-secondary)' }}>
              {this.state.error?.message}
            </p>
            <button
              onClick={() => this.setState({ hasError: false, error: null })}
              className="mt-4 rounded px-4 py-2 text-sm text-white"
              style={{ background: 'var(--color-accent)' }}
            >
              Try again
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
