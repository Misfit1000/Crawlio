import { Globe2 } from 'lucide-react';
import { useAuth } from '../../contexts/AuthContext';
import { PageHeader, Notice } from '../ui/page-system';
import ProjectCockpit from './ProjectCockpit';

export default function ProjectsPage({ onStartAudit, onOpenReports }: { onStartAudit: () => void; onOpenReports: () => void }) {
  const { user } = useAuth();
  return <div className="space-y-8">
    <PageHeader icon={Globe2} title="Projects" description="Your websites, latest results and audit schedules." actions={<button className="trust-button" onClick={onStartAudit}>Start audit</button>} />
    {user ? <ProjectCockpit onStartAudit={onStartAudit} onOpenReports={onOpenReports} /> : <Notice title="Sign in to manage projects">Your saved websites and scheduled audits will appear here after you sign in.</Notice>}
  </div>;
}
