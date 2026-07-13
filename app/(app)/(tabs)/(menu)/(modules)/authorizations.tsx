import React from 'react';
import { ModulePlaceholder } from '@/components/ModulePlaceholder';

export default function Screen() {
  return (
    <ModulePlaceholder
      title="Upoważnienia do polowania"
      icon="file-certificate"
      description="Upoważnienia do wykonywania polowania indywidualnego (odstrzały)."
      endpoints={[
        'GET   /units/{unit-id}/authorizations',
        'GET   /units/{unit-id}/authorizations/me',
        'GET   /units/{unit-id}/authorizations/next-number',
        'POST  .../authorizations/{id}:issue :extend :block :return :reserve',
        'POST  .../authorizations/{id}:generate-document',
      ]}
    />
  );
}
