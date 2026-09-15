import type { Metadata } from 'next';
import './globals.css';
import PageTools from './page-tools';
export const metadata: Metadata = { title: 'RailBlock AI | Railway Maintenance', description: 'Railway maintenance crew assignments for department heads and workers.' };
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return <html lang="en"><body><PageTools/>{children}</body></html>;
}
