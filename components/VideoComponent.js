import React from 'react';
import { Alert } from 'react-bootstrap';

export class VideoComponent extends React.Component {
  render() {
    let account = this.props.account
    return (
      <Alert variant="info">{JSON.stringify(account)}</Alert>
    );
  }
};
