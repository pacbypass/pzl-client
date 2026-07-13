import React from 'react';
import { ModulePlaceholder } from '@/components/ModulePlaceholder';

export default function Screen() {
  return (
    <ModulePlaceholder
      title="Książka materiałowa"
      icon="clipboard-list"
      description="Gospodarka materiałowa koła łowieckiego."
      endpoints={['GET/POST  /units/{unit-id}/material-book']}
    />
  );
}
