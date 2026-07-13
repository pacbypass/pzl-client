import React from 'react';
import { ModulePlaceholder } from '@/components/ModulePlaceholder';

export default function Screen() {
  return (
    <ModulePlaceholder
      title="Raporty ASF"
      icon="virus"
      description="Tygodniowe raporty ASF zarządów okręgowych i ich zestawienia."
      endpoints={[
        'GET  /units/{unit-id}/district-board-reports/asf-weekly',
        'GET  .../asf-weekly/summaries',
        'GET  .../asf-weekly/summaries/all/district-boards',
      ]}
    />
  );
}
