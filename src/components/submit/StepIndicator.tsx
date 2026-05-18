type StepState = 'completed' | 'active' | 'upcoming'

type StepIndicatorProps = {
  steps: string[]
  currentStep: number
}

function getStepState(index: number, currentStep: number): StepState {
  if (index < currentStep) return 'completed'
  if (index === currentStep) return 'active'
  return 'upcoming'
}

const stateStyles: Record<StepState, string> = {
  completed: 'bg-[#1A1918] text-white',
  active: 'bg-[#E06B3F] text-white',
  upcoming: 'bg-[#F5F4F1] text-[#7C7570]',
}

export function StepIndicator({ steps, currentStep }: StepIndicatorProps) {
  return (
    <div className="flex items-center justify-center gap-2">
      {steps.map((label, index) => {
        const state = getStepState(index, currentStep)
        return (
          <div
            key={index}
            data-state={state}
            className={`rounded-full px-5 py-2 text-[13px] font-medium ${stateStyles[state]}`}
          >
            {index + 1}  {label}
          </div>
        )
      })}
    </div>
  )
}
