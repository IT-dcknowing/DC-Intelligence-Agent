import React, { useEffect, useState } from 'react';
import { Check, AlertCircle, AlertTriangle, Info, X } from 'lucide-react';
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
      if (remaining <= 0) { clearInterval(interval); onDismiss(toast.id); }
    }, 50);
    return () => clearInterval(interval);
  }, [toast.id, onDismiss]);

  // Acme/shadcn: all toasts dark/monochrome
  const config = {
    success: {
      icon: Check,
      bg: '#09090B',
      iconColor: '#fff',
      titleColor: '#fff',
      msgColor: '#A1A1AA',
      progressBg: '#3F3F46',
      progressFill: '#71717A',
    },
    error: {
      icon: AlertCircle,
      bg: '#18181B',
      iconColor: '#fff',
      titleColor: '#fff',
      msgColor: '#A1A1AA',
      progressBg: '#27272A',
      progressFill: '#71717A',
    },
    warning: {
      icon: AlertTriangle,
      bg: '#27272A',
      iconColor: '#fff',
      titleColor: '#fff',
      msgColor: '#A1A1AA',
      progressBg: '#3F3F46',
      progressFill: '#71717A',
    },
    info: {
      icon: Info,
      bg: '#09090B',
      iconColor: '#fff',
      titleColor: '#fff',
      msgColor: '#A1A1AA',
      progressBg: '#3F3F46',
      progressFill: '#52525B',
    },
  }[toast.type];

  const Icon = config.icon;

  return (
    <div
      className="animate-in fade-in"
      style={{
        width: 320,
        background: config.bg,
        borderRadius: '10px',
        overflow: 'hidden',
        display: 'flex',
        flexDirection: 'column',
        fontFamily: "'Inter', sans-serif",
      }}
    >
      <div style={{ padding: '12px 14px', display: 'flex', alignItems: 'flex-start', gap: 10 }}>
        <div
          style={{
            width: 20, height: 20,
            borderRadius: '50%',
            background: 'rgba(255,255,255,0.15)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            flexShrink: 0, marginTop: 1,
          }}
        >
          <Icon style={{ width: 11, height: 11, color: config.iconColor, strokeWidth: 2.5 }} />
        </div>
        <div style={{ flex: 1, minWidth: 0, paddingRight: 8 }}>
          <p style={{ fontSize: '13px', fontWeight: 600, color: config.titleColor, lineHeight: 1.4 }}>
            {toast.title}
          </p>
          {toast.message && (
            <p style={{ fontSize: '12px', color: config.msgColor, marginTop: 2, lineHeight: 1.5 }}>
              {toast.message}
            </p>
          )}
        </div>
        <button
          type="button"
          onClick={() => onDismiss(toast.id)}
          style={{ color: '#52525B', cursor: 'pointer', background: 'none', border: 'none', padding: '2px', lineHeight: 1 }}
          onMouseEnter={(e) => ((e.currentTarget as HTMLElement).style.color = '#fff')}
          onMouseLeave={(e) => ((e.currentTarget as HTMLElement).style.color = '#52525B')}
        >
          <X style={{ width: 13, height: 13 }} />
        </button>
      </div>
      {/* Progress bar */}
      <div style={{ width: '100%', height: 2, background: config.progressBg }}>
        <div
          style={{
            height: '100%',
            width: `${progress}%`,
            background: config.progressFill,
            transition: 'width 75ms linear',
          }}
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
      style={{ position: 'fixed', top: 16, right: 16, zIndex: 9999, display: 'flex', flexDirection: 'column', gap: 8, pointerEvents: 'auto' }}
    >
      {toasts.map((toast) => (
        <ToastItem key={toast.id} toast={toast} onDismiss={onDismiss} />
      ))}
    </div>
  );
};
