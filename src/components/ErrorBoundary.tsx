import { Component, type ErrorInfo, type ReactNode } from 'react';
import { AlertTriangle, RotateCw } from 'lucide-react';

interface ErrorBoundaryProps {
  children: ReactNode;
}

interface ErrorBoundaryState {
  hasError: boolean;
  message: string;
}

export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = {
    hasError: false,
    message: '',
  };

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    let readable = error.message || 'เกิดข้อผิดพลาดในการเชื่อมต่อระบบ';
    try {
      const parsed = JSON.parse(error.message) as {
        error?: string;
        operationType?: string;
        path?: string;
      };
      if (parsed && parsed.error) {
        if (parsed.error.includes('Quota exceeded')) {
          readable =
            'โควตาการใช้งาน Firestore วันนี้เต็มแล้ว โควตาจะรีเซ็ตในวันถัดไป';
        } else if (parsed.error.includes('Missing or insufficient permissions')) {
          readable = `ไม่มีสิทธิ์เข้าถึงข้อมูล (${parsed.operationType ?? 'read'} ${parsed.path ?? ''})`;
        } else {
          readable = parsed.error;
        }
      }
    } catch {
      // keep plain message
    }
    return { hasError: true, message: readable };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error('Application ErrorBoundary caught:', error, info);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen bg-slate-50 dark:bg-slate-950 flex items-center justify-center p-4">
          <div className="max-w-md w-full bg-white dark:bg-slate-900 border border-rose-200 dark:border-rose-900/60 rounded-2xl p-6 shadow-lg text-center space-y-4">
            <div className="w-12 h-12 rounded-xl bg-rose-50 dark:bg-rose-950/40 text-rose-600 dark:text-rose-400 flex items-center justify-center mx-auto">
              <AlertTriangle className="w-6 h-6" />
            </div>
            <div className="space-y-1.5">
              <h1 className="text-base font-bold text-slate-900 dark:text-slate-100">
                พบข้อผิดพลาดในการทำงาน
              </h1>
              <p className="text-xs text-slate-600 dark:text-slate-400 leading-relaxed break-words">
                {this.state.message}
              </p>
            </div>
            <button
              type="button"
              onClick={() => window.location.reload()}
              className="inline-flex items-center justify-center gap-2 h-10 px-4 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold cursor-pointer"
            >
              <RotateCw className="w-4 h-4" />
              <span>โหลดหน้าเว็บใหม่</span>
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
