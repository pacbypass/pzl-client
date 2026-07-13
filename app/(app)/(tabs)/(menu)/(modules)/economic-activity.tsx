import React from 'react';
import { ModulePlaceholder } from '@/components/ModulePlaceholder';

export default function Screen() {
  return (
    <ModulePlaceholder
      title="Działalność gospodarcza"
      icon="briefcase"
      description="Plany i protokoły działalności gospodarczej koła."
      endpoints={[
        'GET  /units/{unit-id}/economic-activity-plans',
        'GET  /units/{unit-id}/economic-activity-protocols',
      ]}
    />
  );
}
