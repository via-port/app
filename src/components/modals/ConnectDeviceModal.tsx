import {faPlus, faSpinner} from '@fortawesome/free-solid-svg-icons';
import {FontAwesomeIcon} from '@fortawesome/react-fontawesome';
import React, {useCallback, useEffect, useMemo, useState} from 'react';
import {useTranslation} from 'react-i18next';
import styled from 'styled-components';
import {HID} from 'src/shims/node-hid';
import {
  getConnectedDevices,
  getSelectedDevicePath,
  getSupportedIds,
} from 'src/store/devicesSlice';
import {
  reloadConnectedDevices,
  requestAuthorizationAndReload,
  selectConnectedDeviceByPath,
} from 'src/store/devicesThunks';
import {useAppDispatch, useAppSelector} from 'src/store/hooks';
import type {WebVIADevice} from 'src/types/types';
import {formatNumberAsHex} from 'src/utils/format';
import {getVendorProductId} from 'src/utils/hid-keyboards';
import {AccentButton, PrimaryAccentButton} from '../inputs/accent-button';
import {ModalBackground, ModalContainer, PromptText, RowDiv} from '../inputs/dialog-base';
import {ErrorMessage, Message} from '../styled';

const ModalBackgroundHigh = styled(ModalBackground)`
  z-index: 1000;
  padding: 20px;
`;

const ModalContainerWide = styled(ModalContainer)`
  width: 640px;
  max-width: calc(100vw - 40px);
  min-width: 0;
`;

const HeaderRow = styled.div`
  width: 100%;
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 12px;
`;

const Title = styled(PromptText)`
  text-align: left;
  font-size: 22px;
`;

const Body = styled.div`
  width: 100%;
`;

const DeviceList = styled.ul`
  list-style: none;
  padding: 0;
  margin: 0;
  display: flex;
  flex-direction: column;
  gap: 10px;
`;

const DeviceButton = styled.button<{
  $selected: boolean;
  $disabled: boolean;
}>`
  width: 100%;
  border-radius: 6px;
  border: 1px solid var(--border_color_cell);
  background: ${(p) => (p.$selected ? 'var(--bg_icon-highlighted)' : 'var(--bg_control)')};
  color: var(--color_label);
  text-align: left;
  padding: 10px 12px;
  display: flex;
  flex-direction: column;
  gap: 4px;
  cursor: ${(p) => (p.$disabled ? 'not-allowed' : 'pointer')};
  pointer-events: ${(p) => (p.$disabled ? 'none' : 'auto')};
  opacity: ${(p) => (p.$disabled ? 0.6 : 1)};

  &:hover {
    filter: brightness(0.95);
  }
`;

const DeviceTopRow = styled.div`
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 10px;
`;

const DeviceName = styled.div`
  font-weight: 600;
  color: var(--color_label-highlighted);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
`;

const DeviceBadges = styled.div`
  display: flex;
  align-items: center;
  gap: 8px;
  flex-shrink: 0;
`;

const Badge = styled.span<{ $kind: 'selected' | 'connected' | 'unsupported' }>`
  font-variant-numeric: tabular-nums;
  border-radius: 999px;
  padding: 2px 8px;
  font-size: 12px;
  border: 1px solid
    ${(p) =>
      p.$kind === 'unsupported'
        ? 'var(--color_error)'
        : p.$kind === 'connected'
          ? 'var(--color_accent)'
          : 'var(--border_color_cell)'};
  color: ${(p) =>
    p.$kind === 'unsupported'
      ? 'var(--color_error)'
      : p.$kind === 'connected'
        ? 'var(--color_accent)'
        : 'var(--color_label)'};
`;

const DeviceMeta = styled.div`
  font-variant-numeric: tabular-nums;
  color: var(--color_label);
  opacity: 0.9;
  font-size: 14px;
`;

const InfoRow = styled.div`
  width: 100%;
  display: flex;
  justify-content: center;
  align-items: center;
  min-height: 22px;
`;

const InlineSpinner = styled.span`
  margin-right: 8px;
`;

export const ConnectDeviceModal: React.FC<{
  show: boolean;
  onClose: () => void;
}> = ({show, onClose}) => {
  const {t} = useTranslation();
  const dispatch = useAppDispatch();

  const connectedDevices = useAppSelector(getConnectedDevices);
  const selectedDevicePath = useAppSelector(getSelectedDevicePath);
  const supportedIds = useAppSelector(getSupportedIds);

  const [authorizedDevices, setAuthorizedDevices] = useState<WebVIADevice[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isRequesting, setIsRequesting] = useState(false);
  const [infoMessage, setInfoMessage] = useState<string | null>(null);

  const supportedIdsLoaded = useMemo(
    () => Object.keys(supportedIds).length > 0,
    [supportedIds],
  );

  const refreshAuthorizedDevices = useCallback(async () => {
    setIsLoading(true);
    const devices = await HID.devices(false);
    setAuthorizedDevices(devices);
    setIsLoading(false);
  }, []);

  useEffect(() => {
    if (!show) return;

    let alive = true;
    setInfoMessage(null);
    setIsLoading(true);

    (async () => {
      const devices = await HID.devices(false);
      if (!alive) return;
      setAuthorizedDevices(devices);
      setIsLoading(false);
    })();

    dispatch(reloadConnectedDevices());

    return () => {
      alive = false;
    };
  }, [show, dispatch]);

  const onAddDevice = useCallback(async () => {
    setInfoMessage(null);
    setIsRequesting(true);

    const res = await dispatch(requestAuthorizationAndReload());
    setIsRequesting(false);

    if (res.status === 'cancelled') {
      setInfoMessage(t('Selection cancelled.'));
      return;
    }

    if (res.status === 'error') {
      setInfoMessage(t('Authorization failed.'));
      return;
    }

    await refreshAuthorizedDevices();
  }, [dispatch, refreshAuthorizedDevices, t]);

  const onSelectDevice = useCallback(
    async (device: WebVIADevice) => {
      setInfoMessage(null);
      const ok = await dispatch(selectConnectedDeviceByPath(device.path));
      if (ok) {
        onClose();
      } else {
        setInfoMessage(
          t('Unable to connect to the device (unsupported or already in use).'),
        );
      }
    },
    [dispatch, onClose, t],
  );

  const closeModal = useCallback(() => {
    if (isRequesting) return;
    onClose();
  }, [isRequesting, onClose]);

  if (!show) return null;

  const isEmpty = !isLoading && authorizedDevices.length === 0;

  return (
    <ModalBackgroundHigh
      onClick={() => {
        closeModal();
      }}
    >
      <ModalContainerWide
        onClick={(e) => {
          e.stopPropagation();
        }}
      >
        <HeaderRow>
          <Title>{t('Connect keyboard')}</Title>
        </HeaderRow>

        <Body>
          {isLoading ? (
            <div style={{textAlign: 'center', color: 'var(--color_accent)'}}>
              <FontAwesomeIcon spinPulse icon={faSpinner} />
            </div>
          ) : isEmpty ? (
            <div style={{textAlign: 'center'}}>
              <Message>{t('No authorized devices found.')}</Message>
            </div>
          ) : (
            <DeviceList>
              {authorizedDevices.map((d) => {
                const isSelected = selectedDevicePath === d.path;
                const connected = connectedDevices[d.path];

                const vpid =
                  d.vendorId >= 0 && d.productId >= 0
                    ? getVendorProductId(d.vendorId, d.productId)
                    : null;
                const isSupported =
                  !supportedIdsLoaded || vpid === null
                    ? true
                    : Object.prototype.hasOwnProperty.call(supportedIds, vpid);
                const isDisabled =
                  supportedIdsLoaded && vpid !== null && !isSupported;

                const vidPid =
                  d.vendorId >= 0 && d.productId >= 0
                    ? `${formatNumberAsHex(d.vendorId, 4)} / ${formatNumberAsHex(
                        d.productId,
                        4,
                      )}`
                    : undefined;

                return (
                  <li key={d.path}>
                    <DeviceButton
                      type="button"
                      $selected={isSelected}
                      $disabled={isDisabled}
                      onClick={() => onSelectDevice(d)}
                    >
                      <DeviceTopRow>
                        <DeviceName>{d.productName || t('Unknown device')}</DeviceName>
                        <DeviceBadges>
                          {isDisabled ? (
                            <Badge $kind="unsupported">{t('Unsupported')}</Badge>
                          ) : null}
                          {connected ? (
                            <Badge $kind="connected">
                              {t('Connected')} {connected.protocol}
                            </Badge>
                          ) : null}
                          {isSelected ? (
                            <Badge $kind="selected">{t('Selected')}</Badge>
                          ) : null}
                        </DeviceBadges>
                      </DeviceTopRow>
                      <DeviceMeta>
                        {vidPid ? `${t('VID/PID')}: ${vidPid}` : null}
                      </DeviceMeta>
                    </DeviceButton>
                  </li>
                );
              })}
            </DeviceList>
          )}
        </Body>

        <InfoRow>
          {infoMessage ? <ErrorMessage>{infoMessage}</ErrorMessage> : null}
        </InfoRow>

        <RowDiv style={{width: 'auto'}}>
          <AccentButton disabled={isRequesting} onClick={closeModal}>
            {t('Close')}
          </AccentButton>
          <PrimaryAccentButton disabled={isRequesting} onClick={onAddDevice}>
            {isRequesting ? (
              <>
                <InlineSpinner>
                  <FontAwesomeIcon spinPulse icon={faSpinner} />
                </InlineSpinner>
                {t('Adding...')}
              </>
            ) : (
              <>
                {t('Add device')}
                <FontAwesomeIcon style={{marginLeft: 10}} icon={faPlus} />
              </>
            )}
          </PrimaryAccentButton>
        </RowDiv>
      </ModalContainerWide>
    </ModalBackgroundHigh>
  );
};
