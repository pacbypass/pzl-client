import React from 'react';
import { ModulePlaceholder } from '@/components/ModulePlaceholder';

export default function Screen() {
  return (
    <ModulePlaceholder
      title="Wieloletnie plany łowieckie"
      icon="chart-timeline-variant"
      description="Wieloletnie łowieckie plany hodowlane."
      endpoints={['GET  /units/{unit-id}/multi-year-plans']}
    />
  );
}
