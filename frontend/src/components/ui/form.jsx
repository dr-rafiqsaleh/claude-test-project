import * as React from 'react'
import { Slot } from '@radix-ui/react-slot'
import { Controller, FormProvider, useFormContext } from 'react-hook-form'

import { cn } from '@/lib/utils'
import { Label } from '@/components/ui/label'

/** Wrap your form in <Form {...methods}> to enable FormField. */
const Form = FormProvider

const FormFieldContext = React.createContext(null)

function FormField(props) {
  return (
    <FormFieldContext.Provider value={{ name: props.name }}>
      <Controller {...props} />
    </FormFieldContext.Provider>
  )
}

const FormItemContext = React.createContext(null)

function useFormField() {
  const fieldContext = React.useContext(FormFieldContext)
  const itemContext = React.useContext(FormItemContext)
  const { getFieldState, formState } = useFormContext()

  if (!fieldContext) {
    throw new Error('useFormField must be used within a <FormField>')
  }
  if (!itemContext) {
    throw new Error('useFormField must be used within a <FormItem>')
  }

  const fieldState = getFieldState(fieldContext.name, formState)
  const { id } = itemContext

  return {
    id,
    name: fieldContext.name,
    formItemId: `${id}-form-item`,
    formDescriptionId: `${id}-form-item-description`,
    formMessageId: `${id}-form-item-message`,
    ...fieldState,
  }
}

const FormItem = React.forwardRef(({ className, ...props }, ref) => {
  const id = React.useId()
  return (
    <FormItemContext.Provider value={{ id }}>
      <div ref={ref} className={cn('space-y-1.5', className)} {...props} />
    </FormItemContext.Provider>
  )
})
FormItem.displayName = 'FormItem'

const FormLabel = React.forwardRef(({ className, ...props }, ref) => {
  const { error, formItemId } = useFormField()
  return (
    <Label
      ref={ref}
      htmlFor={formItemId}
      className={cn(error && 'text-red-600 dark:text-red-400', className)}
      {...props}
    />
  )
})
FormLabel.displayName = 'FormLabel'

const FormControl = React.forwardRef(({ ...props }, ref) => {
  const { error, formItemId, formDescriptionId, formMessageId } = useFormField()
  return (
    <Slot
      ref={ref}
      id={formItemId}
      aria-describedby={error ? `${formDescriptionId} ${formMessageId}` : formDescriptionId}
      aria-invalid={Boolean(error)}
      {...props}
    />
  )
})
FormControl.displayName = 'FormControl'

const FormDescription = React.forwardRef(({ className, ...props }, ref) => {
  const { formDescriptionId } = useFormField()
  return (
    <p
      ref={ref}
      id={formDescriptionId}
      className={cn('text-xs text-slate-500 dark:text-slate-400', className)}
      {...props}
    />
  )
})
FormDescription.displayName = 'FormDescription'

const FormMessage = React.forwardRef(({ className, children, ...props }, ref) => {
  const { error, formMessageId } = useFormField()
  const body = error ? String(error.message ?? '') : children

  if (!body) return null

  return (
    <p
      ref={ref}
      id={formMessageId}
      className={cn('text-xs font-medium text-red-600 dark:text-red-400', className)}
      {...props}
    >
      {body}
    </p>
  )
})
FormMessage.displayName = 'FormMessage'

export {
  useFormField,
  Form,
  FormItem,
  FormLabel,
  FormControl,
  FormDescription,
  FormMessage,
  FormField,
}
