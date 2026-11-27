import * as xb from 'xrblocks';
import {RajaPredictorScene} from './RajaPredictorScene.ts';

document.addEventListener('DOMContentLoaded', () => {
  const options = new xb.Options();
  options.setAppTitle('RAJA AI PREDICTOR');
  options.setAppDescription(
    'Spatial PDF Scanner & Statistical Analytics for Big/Small and Number Distribution.'
  );
  options.reticles.enabled = true;

  xb.add(new RajaPredictorScene());
  void xb.init(options);
});
