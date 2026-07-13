import React from 'react';
import { ModulePlaceholder } from '@/components/ModulePlaceholder';

export default function Screen() {
  return (
    <ModulePlaceholder
      title="Myśliwi i kandydaci"
      icon="account-multiple"
      description="Ewidencja członków koła, stażyści, kandydaci i wnioski."
      endpoints={[
        'GET  /units/{unit-id}/hunters',
        'GET  /units/{unit-id}/hunters-list',
        'GET  /units/{unit-id}/trainees',
        'GET  /units/{unit-id}/candidates',
        'GET  /units/{unit-id}/applications',
        'GET  /units/{unit-id}/role-applications',
      ]}
    />
  );
}
