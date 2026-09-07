import React, { useState } from 'react';
import { Platform, View } from 'react-native';
import { TextInput, TouchableRipple } from 'react-native-paper';
import DateTimePicker from '@react-native-community/datetimepicker';

/** Round to the given minute with seconds pinned to :59 (the app ignores
 *  seconds, so a whole minute counts as "not yet past"). */
export function atSecond59(d: Date): Date {
  const c = new Date(d);
  c.setSeconds(59, 0);
  return c;
}

function fmtDateTime(d: Date): string {
  return d.toLocaleString('pl-PL', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

/**
 * Date + time field (two-step native picker on Android; seconds pinned to :59).
 * Pass no `minimumDate` to allow past dates (e.g. logging a harvest recorded
 * later than the shot).
 */
export function DateTimeField({
  label,
  value,
  onChange,
  minimumDate,
}: {
  label: string;
  value: Date;
  onChange: (d: Date) => void;
  minimumDate?: Date;
}) {
  const [step, setStep] = useState<null | 'date' | 'time'>(null);
  const [temp, setTemp] = useState<Date>(value);

  const open = () => {
    setTemp(value);
    setStep('date');
  };

  return (
    <>
      {/* TouchableRipple + pointerEvents:none makes the WHOLE field tappable
          (not just the icon) — an editable={false} TextInput otherwise only
          reacts near its right icon. */}
      <TouchableRipple onPress={open}>
        <View pointerEvents="none">
          <TextInput
            label={label}
            mode="outlined"
            editable={false}
            value={fmtDateTime(value)}
            right={<TextInput.Icon icon="calendar" />}
          />
        </View>
      </TouchableRipple>
      {step === 'date' ? (
        <DateTimePicker
          value={temp}
          mode="date"
          is24Hour
          minimumDate={minimumDate}
          onChange={(e, d) => {
            if (e.type === 'dismissed' || !d) {
              setStep(null);
              return;
            }
            const merged = new Date(d);
            merged.setHours(temp.getHours(), temp.getMinutes(), 59, 0);
            setTemp(merged);
            setStep(Platform.OS === 'ios' ? null : 'time');
            if (Platform.OS === 'ios') onChange(atSecond59(merged));
          }}
        />
      ) : null}
      {step === 'time' ? (
        <DateTimePicker
          value={temp}
          mode="time"
          is24Hour
          onChange={(e, d) => {
            setStep(null);
            if (e.type === 'dismissed' || !d) return;
            const merged = new Date(temp);
            merged.setHours(d.getHours(), d.getMinutes(), 59, 0);
            onChange(merged);
          }}
        />
      ) : null}
    </>
  );
}
