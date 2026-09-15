import React, { useEffect, useState } from 'react';
import { CheckCircle2, AlertCircle, AlertTriangle, Info, X } from 'lucide-react';
import { ToastMessage } from '../types';

interface ToastItemProps {
  toast: ToastMessage;
  onDismiss: (id: string) => void;
}

const ToastItem: React.FC<ToastItemProps> = ({ toast, onDismiss }) => {
  const [progress, setProgress] = useState(100);

  useEffect(() => {
    const startTime = Date.now();
    const duration = 4000;

    const interval = setInterval(() => {
      const elapsed = Date.now() - startTime;
      const remaining = Math.max(0, 100 - (elapsed / duration) * 100);
      setProgress(remaining);
      if (remaining <= 0) {
        clearInterval(interval);
        onDismiss(toast.id);
      }
    }, 50);

    return () => clearInterval(interval);
  }, [toast.id, onDismiss]);

  const config = {
    success: {
      icon: CheckCircle2,
      border: 'border-[#10B981]/30',
      bg: 'bg-white',
      accent: '#10B981',
      text: 'text-[#10B981]',
      progressBg: 'bg-[#10B981]',
    },
    error: {
      icon: AlertCircle,
      border: 'border-[#EF4444]/30',
      bg: 'bg-white',
      accent: '#EF4444',
      text: 'text-[#EF4444]',
      progressBg: 'bg-[#EF4444]',
    },
    warning: {
      icon: AlertTriangle,
      border: 'border-[#F59E0B]/30',
      bg: 'bg-white',
      accent: '#F59E0B',
      text: 'text-[#F59E0B]',
      progressBg: 'bg-[#F59E0B]',
    },
    info: {
      icon: Info,
      border: 'border-black/30',
      bg: 'bg-white',
      accent: '#000000',
      text: 'text-black',
      progressBg: 'bg-black',
    },
  }[toast.type];

  const Icon = config.icon;

  return (
    <div
      className={`relative w-80 sm:w-96 rounded-xl border ${config.border} ${config.bg} shadow-lg overflow-hidden flex flex-col transition-all duration-300 transform translate-y-0 opacity-100`}
    >
      <div className="p-3.5 flex items-start gap-3">
        <Icon className={`w-5 h-5 ${config.text} shrink-0 mt-0.5`} />
        <div className="flex-1 min-w-0 pr-2">
          <h4 className="text-[13px] font-semibold text-[#1E293B] leading-tight">
            {toast.title}
          </h4>
          {toast.message && (
            <p className="text-[12px] text-[#64748B] mt-0.5 leading-relaxed">
              {toast.message}
            </p>
          )}
        </div>
        <button
          type="button"
          onClick={() => onDismiss(toast.id)}
          className="text-[#94A3B8] hover:text-[#1E293B] transition-colors p-1"
        >
          <X className="w-3.5 h-3.5" />
        </button>
      </div>

      {/* Progress bar */}
      <div className="w-full bg-[#E2E8F0] h-[3px]">
        <div
          className={`h-full ${config.progressBg} transition-all duration-75`}
          style={{ width: `${progress}%` }}
        />
      </div>
    </div>
  );
};

interface ToastContainerProps {
  toasts: ToastMessage[];
  onDismiss: (id: string) => void;
}

export const ToastContainer: React.FC<ToastContainerProps> = ({ toasts, onDismiss }) => {
  if (toasts.length === 0) return null;

  return (
    <div
      id="toast-notifications-container"
      className="fixed top-4 right-4 z-50 flex flex-col gap-2.5 pointer-events-auto"
    >
      {toasts.map((toast) => (
        <ToastItem key={toast.id} toast={toast} onDismiss={onDismiss} />
      ))}
    </div>
  );
};
