
'use client';

import React, { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { useToast } from '@/hooks/useToast';

export default function NewAgentPage() {
  const router = useRouter();
  const { toast } = useToast();
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [model, setModel] = useState('');
  const [systemPrompt, setSystemPrompt] = useState('');
  const [level, setLevel] = useState(0);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);

    try {
      const response = await fetch('/api/agents', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          id: `agent-${Date.now()}`,
          name, 
          description, 
          model, 
          systemPrompt, 
          level, 
          availableTools: [] 
        }),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Failed to create agent');
      }

      toast({ title: 'Agent created successfully' });
      router.push('/agents');
    } catch (error) {
      toast({ 
        title: 'Error creating agent', 
        description: error instanceof Error ? error.message : 'Unknown error',
        variant: 'destructive',
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">Create New Agent</h1>
      <Card>
        <CardHeader>
          <CardTitle>Agent Details</CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label htmlFor="name" className="block text-sm font-medium text-gray-700">Name</label>
              <Input id="name" value={name} onChange={(e) => setName(e.target.value)} required />
            </div>
            <div>
              <label htmlFor="description" className="block text-sm font-medium text-gray-700">Description</label>
              <Textarea id="description" value={description} onChange={(e) => setDescription(e.target.value)} required />
            </div>
            <div>
              <label htmlFor="model" className="block text-sm font-medium text-gray-700">Model</label>
              <Input id="model" value={model} onChange={(e) => setModel(e.target.value)} required />
            </div>
            <div>
              <label htmlFor="systemPrompt" className="block text-sm font-medium text-gray-700">System Prompt</label>
              <Textarea id="systemPrompt" value={systemPrompt} onChange={(e) => setSystemPrompt(e.target.value)} required rows={6} />
            </div>
            <div>
              <label htmlFor="level" className="block text-sm font-medium text-gray-700">Level</label>
              <Input id="level" type="number" value={level} onChange={(e) => setLevel(parseInt(e.target.value, 10))} required />
            </div>
            <div className="flex justify-end space-x-2">
              <Button type="button" variant="outline" onClick={() => router.back()}>Cancel</Button>
              <Button type="submit" disabled={isSubmitting}>
                {isSubmitting ? 'Creating...' : 'Create Agent'}
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
