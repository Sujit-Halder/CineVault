import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach } from 'vitest';

afterEach(() => { cleanup(); localStorage.clear(); });

if (!window.matchMedia) window.matchMedia=() => ({ matches:false,addEventListener() {},removeEventListener() {} });
HTMLCanvasElement.prototype.getContext=() => null;
