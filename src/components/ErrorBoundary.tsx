// @ts-nocheck
import React from 'react';

export class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  componentDidCatch(error, info) {
    console.error('[ErrorBoundary]', error, info);
  }

  render() {
    if (this.state.hasError) {
      if (this.props.fallback) return this.props.fallback;
      return (
        <div className="flex-1 flex flex-col items-center justify-center p-8 text-center bg-white">
          <div className="w-12 h-12 rounded-xl bg-red-50 border border-red-200 flex items-center justify-center mb-3 text-red-600">!</div>
          <h3 className="font-bold text-[15px] text-[#1E293B]">Impossible de charger les connexions</h3>
          <p className="text-[12px] text-[#64748B] max-w-md mt-1">
            Une erreur est survenue au rendu. {this.state.error?.message ? `(${this.state.error.message})` : ''}
          </p>
          <button
            type="button"
            onClick={() => this.setState({ hasError: false, error: null })}
            className="mt-4 px-3 py-1.5 rounded-lg bg-black text-white text-[12px] font-semibold hover:bg-zinc-800"
          >
            Réessayer
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
