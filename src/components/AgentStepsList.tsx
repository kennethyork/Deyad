interface AgentStep {
  type: 'tool' | 'result';
  text: string;
}

interface Props {
  steps: AgentStep[];
}

export default function AgentStepsList({ steps }: Props) {
  return (
    <div className="agent-steps">
      <div className="agent-steps-header">Agent Actions</div>
      {steps.map((step, i) => (
        <div key={i} className={`agent-step agent-step-${step.type}`}>
          <span className="agent-step-icon">{step.type === 'tool' ? '🔧' : '📋'}</span>
          <span className="agent-step-text">{step.text}</span>
        </div>
      ))}
    </div>
  );
}
