import { useEffect, useRef } from 'react';
import { AlertCircle, CheckCircle, Info, X } from 'lucide-react';

interface ToastProps {
  message: string;
  type: 'error' | 'success' | 'info';
  visible: boolean;
  onDismiss: () => void;
}

const icons = {
  error: AlertCircle,
  success: CheckCircle,
  info: Info,
};

const styles: Record<string, { border: string; bg: string; text: string }> = {
  error:   { border: 'rgba(239,68,68,0.2)',  bg: 'rgba(239,68,68,0.06)',  text: '#fca5a5' },
  success: { border: 'rgba(34,197,94,0.2)',   bg: 'rgba(34,197,94,0.06)',  text: '#86efac' },
  info:    { border: 'rgba(212,160,23,0.2)',  bg: 'rgba(212,160,23,0.06)', text: '#fbbf24' },
};

export default function Toast({ message, type, visible, onDismiss }: ToastProps) {
  const timerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => {
    if (visible) {
      timerRef.current = setTimeout(() => onDismiss(), 5000);
    }
    return () => clearTimeout(timerRef.current);
  }, [visible, onDismiss]);

  if (!visible) return null;

  const Icon = icons[type];
  const s = styles[type];

  return (
    <div className="fixed top-4 right-4 z-[100] toast-enter">
      <div
        className="flex items-center gap-3 px-4 py-3 rounded-xl max-w-sm animate-fade-in"
        style={{
          background: s.bg,
          border: `1px solid ${s.border}`,
          color: s.text,
          backdropFilter: 'blur(16px)',
          boxShadow: '0 8px 32px rgba(0,0,0,0.3)',
        }}
      >
        <Icon size={15} className="shrink-0" />
        <p className="text-[12px] flex-1 font-medium">{message}</p>
        <button onClick={onDismiss} className="shrink-0 p-1 rounded-md hover:bg-white/10 transition-colors">
          <X size={12} />
        </button>
      </div>
    </div>
  );
}
