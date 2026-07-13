import React from 'react';
import { ModulePlaceholder } from '@/components/ModulePlaceholder';

export default function Screen() {
  return (
    <ModulePlaceholder
      title="Posiedzenia zarządu"
      icon="gavel"
      description="Posiedzenia zarządu koła, uchwały, protokoły i ogłoszenia."
      endpoints={[
        'GET  /units/{unit-id}/board-meetings',
        'GET  /units/{unit-id}/board-protocols',
        'GET  /units/{unit-id}/management-resolution',
        'GET  /units/{unit-id}/management-announcements',
      ]}
    />
  );
}
