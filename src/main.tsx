import { StrictMode, Suspense, lazy } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.tsx';
import './index.css';

const Editor = import.meta.env.DEV
    ? lazy(() => import('./editor/Editor'))
    : null;

function Root() {
    const isEditorRoute =
        typeof window !== 'undefined' &&
        window.location.pathname.replace(/\/+$/, '').endsWith('/editor');

    if (isEditorRoute && Editor) {
        return (
            <Suspense fallback={<EditorLoadingFallback />}>
                <Editor />
            </Suspense>
        );
    }

    return <App />;
}

function EditorLoadingFallback() {
    return (
        <div
            style={{
                position: 'fixed',
                inset: 0,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                background: '#111',
                color: 'rgba(255,255,255,0.6)',
                fontFamily: 'monospace',
                fontSize: '14px',
            }}
        >
            carregando editor…
        </div>
    );
}

createRoot(document.getElementById('root')!).render(
    <StrictMode>
        <Root />
    </StrictMode>
);
