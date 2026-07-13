import React from 'react';
import { ModulePlaceholder } from '@/components/ModulePlaceholder';

export default function Screen() {
  return (
    <ModulePlaceholder
      title="Finanse"
      icon="cash-multiple"
      description="Składki członkowskie, depozyty, umowy i dzierżawy."
      endpoints={[
        'GET  /units/{unit-id}/finances',
        'GET  /units/{unit-id}/deposits',
        'GET  /units/{unit-id}/contracts-leases',
      ]}
    />
  );
}
