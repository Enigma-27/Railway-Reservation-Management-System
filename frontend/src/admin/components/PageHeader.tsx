import React from 'react';
import { ContractGapBadge } from './ContractGapBadge';

interface PageHeaderProps {
  title: string;
  description?: string;
  actions?: React.ReactNode;
  contractGapProposedEndpoint?: string;
}

/** Page title (serif), one line of help text and the page actions. Same header on every admin and staff page. */
export const PageHeader: React.FC<PageHeaderProps> = ({ title, description, actions, contractGapProposedEndpoint }) => (
  <div className="ph">
    <div>
      <div className="flex items-center gap-3 flex-wrap">
        <h1>{title}</h1>
        {contractGapProposedEndpoint && <ContractGapBadge proposedEndpoint={contractGapProposedEndpoint} />}
      </div>
      {description && <p>{description}</p>}
    </div>
    {actions && <div className="flex items-center gap-2 flex-wrap shrink-0">{actions}</div>}
  </div>
);
