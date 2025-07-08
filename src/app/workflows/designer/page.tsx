'use client';

import React, { Suspense } from 'react';
import { useSearchParams } from 'next/navigation';

function WorkflowDesignerContent() {
  const searchParams = useSearchParams();
  const id = searchParams?.get('id');
  const isNewWorkflow = !id;

  return (
    <div className="h-full">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">
          {isNewWorkflow ? 'Create New Workflow' : 'Edit Workflow'}
        </h1>
        <p className="text-gray-600">
          Design your AI agent workflow with a visual mesh network interface
        </p>
      </div>

      <div className="bg-white rounded-lg shadow h-96 flex items-center justify-center">
        <div className="text-center">
          <h3 className="text-lg font-medium text-gray-900 mb-2">
            Workflow Designer Coming Soon
          </h3>
          <p className="text-gray-600">
            Visual drag-and-drop workflow builder with mesh network support
          </p>
        </div>
      </div>
    </div>
  );
}

export default function WorkflowDesigner() {
  return (
    <Suspense fallback={<div>Loading...</div>}>
      <WorkflowDesignerContent />
    </Suspense>
  );
}