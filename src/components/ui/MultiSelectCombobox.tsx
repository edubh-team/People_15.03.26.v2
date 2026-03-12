import { Fragment, useState } from 'react';
import { Combobox, Transition } from '@headlessui/react';
import { ChevronUpDownIcon, CheckIcon, XMarkIcon } from '@heroicons/react/24/outline';

export interface ComboboxOption {
  value: string;
  label: string;
  subLabel?: string;
}

interface MultiSelectComboboxProps {
  label?: string;
  value: string[];
  onChange: (value: string[]) => void;
  options: ComboboxOption[];
  placeholder?: string;
  className?: string;
}

export default function MultiSelectCombobox({
  label,
  value,
  onChange,
  options,
  placeholder = 'Select options...',
  className = '',
}: MultiSelectComboboxProps) {
  const [query, setQuery] = useState('');

  const filteredOptions =
    query === ''
      ? options
      : options.filter((option) =>
          option.label
            .toLowerCase()
            .replace(/\s+/g, '')
            .includes(query.toLowerCase().replace(/\s+/g, ''))
        );

  const removeValue = (valToRemove: string) => {
    onChange(value.filter((v) => v !== valToRemove));
  };

  return (
    <div className={`flex flex-col gap-1 ${className}`}>
      {label && <label className="text-xs font-medium text-slate-500">{label}</label>}
      
      {/* Selected Tags */}
      {value.length > 0 && (
        <div className="flex flex-wrap gap-2 mb-2">
          {value.map((val) => {
            const option = options.find((o) => o.value === val);
            return (
              <span
                key={val}
                className="inline-flex items-center gap-1 rounded-md bg-indigo-50 px-2 py-1 text-xs font-medium text-indigo-700 ring-1 ring-inset ring-indigo-700/10"
              >
                {option?.label || val}
                <button
                  type="button"
                  onClick={() => removeValue(val)}
                  className="group relative -mr-1 h-3.5 w-3.5 rounded-sm hover:bg-indigo-600/20"
                >
                  <span className="sr-only">Remove</span>
                  <XMarkIcon className="h-3.5 w-3.5" />
                </button>
              </span>
            );
          })}
        </div>
      )}

      <Combobox value={value} onChange={onChange} multiple>
        <div className="relative mt-1">
          <div className="relative w-full cursor-default overflow-hidden rounded-lg bg-white text-left border border-slate-300 shadow-sm focus-within:ring-2 focus-within:ring-indigo-500 sm:text-sm">
            <Combobox.Input
              className="w-full border-none py-2 pl-3 pr-10 text-sm leading-5 text-slate-900 focus:ring-0 outline-none"
              displayValue={() => ''}
              onChange={(event) => setQuery(event.target.value)}
              placeholder={value.length === 0 ? placeholder : ''}
            />
            <Combobox.Button className="absolute inset-y-0 right-0 flex items-center pr-2">
              <ChevronUpDownIcon
                className="h-5 w-5 text-slate-400"
                aria-hidden="true"
              />
            </Combobox.Button>
          </div>
          <Transition
            as={Fragment}
            leave="transition ease-in duration-100"
            leaveFrom="opacity-100"
            leaveTo="opacity-0"
            afterLeave={() => setQuery('')}
          >
            <Combobox.Options className="absolute z-50 mt-1 max-h-60 w-full overflow-auto rounded-md bg-white py-1 text-base shadow-lg ring-1 ring-black ring-opacity-5 focus:outline-none sm:text-sm">
              {filteredOptions.length === 0 && query !== '' ? (
                <div className="relative cursor-default select-none py-2 px-4 text-slate-700">
                  Nothing found.
                </div>
              ) : (
                filteredOptions.map((option) => (
                  <Combobox.Option
                    key={option.value}
                    className={({ active }) =>
                      `relative cursor-default select-none py-2 pl-10 pr-4 ${
                        active ? 'bg-indigo-100 text-indigo-900' : 'text-slate-900'
                      }`
                    }
                    value={option.value}
                  >
                    {({ selected, active }) => (
                      <>
                        <span
                          className={`block truncate ${
                            selected ? 'font-medium' : 'font-normal'
                          }`}
                        >
                          {option.label}
                           {option.subLabel && <span className="ml-2 text-xs text-slate-400 font-normal">{option.subLabel}</span>}
                        </span>
                        {selected ? (
                          <span
                            className={`absolute inset-y-0 left-0 flex items-center pl-3 ${
                              active ? 'text-indigo-900' : 'text-indigo-600'
                            }`}
                          >
                            <CheckIcon className="h-5 w-5" aria-hidden="true" />
                          </span>
                        ) : null}
                      </>
                    )}
                  </Combobox.Option>
                ))
              )}
            </Combobox.Options>
          </Transition>
        </div>
      </Combobox>
    </div>
  );
}
