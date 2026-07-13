import React from 'react';
import { ModulePlaceholder } from '@/components/ModulePlaceholder';

export default function Screen() {
  return (
    <ModulePlaceholder
      title="Roczne plany łowieckie"
      icon="calendar-check"
      description="Roczne plany łowieckie (RPŁ), plany wykonania i generowane dokumenty."
      endpoints={[
        'GET  /units/{unit-id}/annual-hunting-plans',
        'GET  /units/{unit-id}/annual-hunting-plans/{hash}',
        'GET  /units/{unit-id}/annual-hunting-plans/execution-plan',
        'GET  /units/{unit-id}/annual-hunting-plans/execution-plan/document',
      ]}
    />
  );
}
