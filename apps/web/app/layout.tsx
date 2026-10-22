import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'UI/UX Auditor — Evidence-backed website reviews',
  description: 'Audit website accessibility, visual consistency, and usability with evidence-backed findings.',
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><body>{children}</body></html>;
}
