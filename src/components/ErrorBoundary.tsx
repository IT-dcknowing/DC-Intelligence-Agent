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
      // fallback peut être un node statique ou une fonction recevant l'erreur,
      // pour afficher le message exact au lieu d'une page blanche muette.
      if (typeof this.props.fallback === 'function') {
        try {
          return this.props.fallback(this.state.error);
        } catch {}
      }
      if (this.props.fallback) return this.props.fallback;
      return (
        <div className="flex-1 flex flex-col items-center justify-center p-8 text-center bg-white">
          <div className="w-12 h-12 rounded-xl bg-[#F9FAFB] border border-[#E5E7EB] flex items-center justify-center mb-3 text-[#1F2937]">!</div>
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
