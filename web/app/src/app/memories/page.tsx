import type { Metadata } from 'next';
import { MemoriesView } from './memories-view';

export const metadata: Metadata = { title: 'Memory' };

export default function MemoriesPage() {
  return <MemoriesView />;
}
