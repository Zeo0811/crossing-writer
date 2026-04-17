import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { TopicExpertsPage } from '../TopicExpertsPage';

vi.mock('../../components/config/TopicExpertPanel.js', () => ({
  TopicExpertPanel: () => <div>topic-expert-panel-stub</div>,
}));

describe('TopicExpertsPage', () => {
  it('renders header and panel', () => {
    render(<TopicExpertsPage />);
    expect(screen.getByText('选题专家')).toBeInTheDocument();
    expect(screen.getByText('topic-expert-panel-stub')).toBeInTheDocument();
  });
});
